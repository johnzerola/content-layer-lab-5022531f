/**
 * Ciclo fechado de métricas → cortes.
 *
 * Cada corte publicado guarda as etiquetas que a IA usou para escolhê-lo
 * (gancho, pico, fala contínua…) em `clip_outcomes`. Quando as métricas reais
 * chegam em `post_insights`, comparamos o desempenho médio de cada etiqueta com
 * a média geral da conta e devolvemos um multiplicador de score.
 *
 * O motor de clipagem (`clips.ts`) usa esse multiplicador para priorizar o que
 * comprovadamente performa NESTE perfil, e não só o que soa bem no papel.
 */

import { supabase } from "@/integrations/supabase/client";
import { currentUser } from "@/lib/cloud";

export interface ClipOutcomeInput {
  postId: string;
  tags: string[];
  score: number;
  seconds?: number;
  source?: string;
}

/** Guarda a "aposta" da IA no momento do agendamento. */
export async function recordClipOutcome(o: ClipOutcomeInput) {
  if (!o.postId || !o.tags?.length) return;
  const user = await currentUser();
  if (!user) return;
  const { error } = await supabase.from("clip_outcomes" as never).upsert(
    {
      user_id: user.id,
      post_id: o.postId,
      tags: o.tags.slice(0, 12),
      predicted_score: Math.round(o.score || 0),
      clip_seconds: Number((o.seconds ?? 0).toFixed(2)),
      source: o.source ?? "corte-ia",
    } as never,
    { onConflict: "post_id" },
  );
  if (error) console.warn("clip_outcomes", error.message);
}

export interface TagPerformance {
  tag: string;
  samples: number;
  /** engajamento médio dos posts com essa etiqueta */
  engagement: number;
  /** multiplicador aplicado ao score do corte (0.75 … 1.30) */
  weight: number;
}

export interface ClipFeedback {
  weights: Record<string, number>;
  tags: TagPerformance[];
  samples: number;
  /** engajamento médio geral da conta */
  baseline: number;
}

export const EMPTY_FEEDBACK: ClipFeedback = { weights: {}, tags: [], samples: 0, baseline: 0 };

/** Engajamento normalizado: reações ponderadas por alcance. */
export function engagementRate(i: {
  views?: number | null;
  reach?: number | null;
  impressions?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
}) {
  const audience = Math.max(1, i.views ?? 0, i.reach ?? 0, i.impressions ?? 0);
  const value =
    (i.likes ?? 0) * 1 + (i.comments ?? 0) * 2 + (i.shares ?? 0) * 3 + (i.saves ?? 0) * 3;
  return Math.min(1, value / audience);
}

const MIN_SAMPLES = 2;

/** Lê o histórico do usuário e transforma desempenho real em pesos por etiqueta. */
export async function getClipFeedback(): Promise<ClipFeedback> {
  const user = await currentUser();
  if (!user) return EMPTY_FEEDBACK;

  const { data: outcomes, error } = await supabase
    .from("clip_outcomes" as never)
    .select("post_id,tags")
    .limit(500);
  if (error || !outcomes?.length) return EMPTY_FEEDBACK;

  const rows = outcomes as unknown as { post_id: string | null; tags: string[] }[];
  const ids = rows.map((r) => r.post_id).filter((v): v is string => Boolean(v));
  if (!ids.length) return EMPTY_FEEDBACK;

  const { data: insights } = await supabase
    .from("post_insights" as never)
    .select("post_id,views,reach,impressions,likes,comments,shares,saves")
    .in("post_id", ids);

  const byPost = new Map<string, number>();
  for (const raw of (insights ?? []) as unknown as Record<string, number | string | null>[]) {
    const id = String(raw['post_id'] ?? "");
    if (!id) continue;
    byPost.set(id, engagementRate(raw as never));
  }
  if (!byPost.size) return EMPTY_FEEDBACK;

  const all: number[] = [];
  const perTag = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.post_id) continue;
    const e = byPost.get(r.post_id);
    if (e === undefined) continue;
    all.push(e);
    for (const t of r.tags ?? []) {
      const list = perTag.get(t) ?? [];
      list.push(e);
      perTag.set(t, list);
    }
  }
  if (!all.length) return EMPTY_FEEDBACK;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const baseline = mean(all);
  if (baseline <= 0) return { ...EMPTY_FEEDBACK, samples: all.length };

  const tags: TagPerformance[] = [];
  const weights: Record<string, number> = {};
  for (const [tag, list] of perTag) {
    if (list.length < MIN_SAMPLES) continue;
    const avg = mean(list);
    const lift = (avg - baseline) / baseline;
    // amortece amostras pequenas (shrinkage) e limita o efeito
    const confidence = list.length / (list.length + 3);
    const weight = Math.max(0.75, Math.min(1.3, 1 + Math.tanh(lift) * 0.3 * confidence));
    weights[tag] = Number(weight.toFixed(3));
    tags.push({ tag, samples: list.length, engagement: avg, weight: weights[tag]! });
  }
  tags.sort((a, b) => b.weight - a.weight);

  return { weights, tags, samples: all.length, baseline };
}
