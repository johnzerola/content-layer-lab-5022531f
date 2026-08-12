/** Enquadramento dinâmico por timeline: uma "câmera virtual" que muda de
 *  posição, zoom e layout ao longo do vídeo.
 *
 *  O vídeo original nunca é alterado — guardamos só instruções normalizadas
 *  (0..1), lidas de forma idêntica pelo preview e pela exportação (draw.ts). */

import type { LayoutKind, PreCrop } from "./preedit";

export type FramingLayout = "auto" | "single" | "split" | "spotlight" | "centered" | "full" | "manual";

export type FramingTransition = "cut" | "smooth" | "pan" | "zoom";

export type Slot = "main" | "top" | "bottom";

/** Posição de uma pessoa num instante (caixa normalizada no vídeo original). */
export interface SpeakerSample {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** energia/atividade estimada nesse instante (proxy de "está falando") */
  a?: number;
}

export interface Speaker {
  id: string;
  label: string;
  color: string;
  /** posição média (usada quando não há amostra por perto) */
  box: PreCrop;
  samples: SpeakerSample[];
}

export interface FramingTarget {
  slot: Slot;
  /** pessoa associada (null = região livre) */
  speaker: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 1 = sem aproximação; >1 aproxima dentro da área */
  zoom: number;
  /** acompanha a pessoa quando ela se move */
  track: boolean;
}

export interface FramingSegment {
  id: string;
  /** início em segundos (o fim é o início do próximo ponto) */
  start: number;
  layout: FramingLayout;
  transition: FramingTransition;
  /** duração da transição em segundos */
  dur: number;
  targets: FramingTarget[];
}

export interface FramingPlan {
  enabled: boolean;
  speakers: Speaker[];
  segments: FramingSegment[];
}

export const FRAMING_LAYOUTS: { id: FramingLayout; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Decide entre preencher e mostrar inteiro" },
  { id: "single", label: "Single", hint: "Uma pessoa ocupando o vídeo vertical" },
  { id: "split", label: "Split", hint: "Duas regiões independentes (topo e base)" },
  { id: "spotlight", label: "Spotlight", hint: "Destaque em cima, contexto embaixo" },
  { id: "centered", label: "Centered", hint: "Recorte central com fundo suave" },
  { id: "full", label: "Full frame", hint: "Mostra o quadro original inteiro" },
  { id: "manual", label: "Manual", hint: "Você define área, posição e zoom" },
];

export const FRAMING_TRANSITIONS: { id: FramingTransition; label: string; hint: string }[] = [
  { id: "cut", label: "Cut", hint: "Troca instantânea" },
  { id: "smooth", label: "Smooth", hint: "Interpola posição e zoom" },
  { id: "pan", label: "Pan", hint: "Câmera desliza até o novo ponto" },
  { id: "zoom", label: "Zoom", hint: "Pequena aproximação durante a troca" },
];

export const SEGMENT_COLORS = [
  "#22c55e",
  "#38bdf8",
  "#f472b6",
  "#f59e0b",
  "#a78bfa",
  "#f87171",
  "#2dd4bf",
];

export const SPEAKER_COLORS = SEGMENT_COLORS;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function normalizeCrop(c: PreCrop): PreCrop {
  const w = Math.max(0.08, Math.min(1, c.w));
  const h = Math.max(0.08, Math.min(1, c.h));
  return { w, h, x: clamp01(Math.min(c.x, 1 - w)), y: clamp01(Math.min(c.y, 1 - h)) };
}

export function defaultFramingPlan(): FramingPlan {
  return { enabled: false, speakers: [], segments: [] };
}

export function newId() {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Recorte vertical (proporção `ratio`) centrado em (cx, cy) do vídeo original. */
export function verticalCrop(cx: number, cy: number, srcW: number, srcH: number, ratio = 9 / 16, zoom = 1): PreCrop {
  const srcAR = srcW && srcH ? srcW / srcH : 16 / 9;
  let w: number;
  let h: number;
  if (ratio > srcAR) {
    h = srcAR / ratio;
    w = 1;
  } else {
    w = ratio / srcAR;
    h = 1;
  }
  const k = 1 / Math.max(1, zoom);
  w *= k;
  h *= k;
  return normalizeCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export function defaultTarget(slot: Slot, srcW: number, srcH: number, speaker?: Speaker | null): FramingTarget {
  const ratio = slot === "main" ? 9 / 16 : 9 / 8;
  const cx = speaker ? speaker.box.x + speaker.box.w / 2 : 0.5;
  const cy = speaker ? speaker.box.y + speaker.box.h / 2 : 0.5;
  const c = verticalCrop(cx, cy, srcW, srcH, ratio, 1);
  return { slot, speaker: speaker?.id ?? null, ...c, zoom: 1, track: Boolean(speaker) };
}

export function defaultSegment(
  start: number,
  srcW: number,
  srcH: number,
  layout: FramingLayout = "single",
  speaker?: Speaker | null,
): FramingSegment {
  const targets =
    layout === "split"
      ? [defaultTarget("top", srcW, srcH, speaker ?? null), defaultTarget("bottom", srcW, srcH, null)]
      : [defaultTarget("main", srcW, srcH, speaker ?? null)];
  return { id: newId(), start: Math.max(0, Number(start.toFixed(2))), layout, transition: "smooth", dur: 0.35, targets };
}

/** Ordena e remove pontos colados demais (< 0.15s). */
export function sortSegments(segs: FramingSegment[]): FramingSegment[] {
  const out = [...segs].sort((a, b) => a.start - b.start);
  return out.filter((s, i) => i === 0 || s.start - out[i - 1]!.start > 0.15);
}

export function segmentIndexAt(plan: FramingPlan | null | undefined, t: number): number {
  const segs = plan?.segments ?? [];
  if (!segs.length) return -1;
  let i = 0;
  for (let j = 0; j < segs.length; j++) if (segs[j]!.start <= t + 1e-4) i = j;
  return i;
}

export function segmentEnd(plan: FramingPlan, i: number, duration: number) {
  const next = plan.segments[i + 1];
  return next ? next.start : duration;
}

/** Posição suavizada da pessoa em `t` (com zona morta pra não tremer). */
export function speakerCenterAt(sp: Speaker | undefined | null, t: number): { cx: number; cy: number } | null {
  if (!sp) return null;
  const base = { cx: sp.box.x + sp.box.w / 2, cy: sp.box.y + sp.box.h / 2 };
  const s = sp.samples;
  if (!s || s.length === 0) return base;
  // média ponderada das amostras próximas — suaviza o rastreamento
  const WIN = 1.1;
  let wsum = 0;
  let cx = 0;
  let cy = 0;
  for (const p of s) {
    const d = Math.abs(p.t - t);
    if (d > WIN) continue;
    const w = 1 - d / WIN;
    wsum += w;
    cx += (p.x + p.w / 2) * w;
    cy += (p.y + p.h / 2) * w;
  }
  if (wsum <= 0) return base;
  return { cx: cx / wsum, cy: cy / wsum };
}

/** Recorte efetivo de um alvo (aplica zoom e, se pedido, o rastreamento). */
export function targetCrop(plan: FramingPlan, tg: FramingTarget, t: number): PreCrop {
  const k = 1 / Math.max(0.2, tg.zoom || 1);
  let w = tg.w * k;
  let h = tg.h * k;
  let cx = tg.x + tg.w / 2;
  let cy = tg.y + tg.h / 2;
  if (tg.track && tg.speaker) {
    const sp = plan.speakers.find((s) => s.id === tg.speaker);
    const now = speakerCenterAt(sp, t);
    if (sp && now) {
      const base = { cx: sp.box.x + sp.box.w / 2, cy: sp.box.y + sp.box.h / 2 };
      const dx = now.cx - base.cx;
      const dy = now.cy - base.cy;
      // zona morta: micro-movimentos não mexem a câmera virtual
      const DEAD = 0.012;
      cx += Math.abs(dx) > DEAD ? dx - Math.sign(dx) * DEAD : 0;
      cy += Math.abs(dy) > DEAD ? dy - Math.sign(dy) * DEAD : 0;
    }
  }
  w = Math.max(0.08, Math.min(1, w));
  h = Math.max(0.08, Math.min(1, h));
  return normalizeCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export interface ResolvedFraming {
  layout: LayoutKind;
  primary: PreCrop;
  secondary: PreCrop | null;
  index: number;
}

export function layoutToKind(l: FramingLayout): LayoutKind {
  switch (l) {
    case "single":
    case "manual":
      return "fill";
    case "split":
      return "split";
    case "spotlight":
      return "spotlight";
    case "centered":
      return "centered";
    case "full":
      return "fit";
    default:
      return "auto";
  }
}

const mixCrop = (a: PreCrop, b: PreCrop, k: number): PreCrop => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  w: a.w + (b.w - a.w) * k,
  h: a.h + (b.h - a.h) * k,
});

const grow = (c: PreCrop, f: number): PreCrop =>
  normalizeCrop({ x: c.x + c.w / 2 - (c.w * f) / 2, y: c.y + c.h / 2 - (c.h * f) / 2, w: c.w * f, h: c.h * f });

function cropsOf(plan: FramingPlan, seg: FramingSegment, t: number) {
  const main = seg.targets.find((x) => x.slot === "main" || x.slot === "top") ?? seg.targets[0];
  const sec = seg.targets.find((x) => x.slot === "bottom") ?? null;
  return {
    primary: main ? targetCrop(plan, main, t) : { x: 0, y: 0, w: 1, h: 1 },
    secondary: sec ? targetCrop(plan, sec, t) : null,
  };
}

/** Enquadramento válido no instante `t` — usado por preview e exportação. */
export function resolveFraming(plan: FramingPlan | null | undefined, t?: number): ResolvedFraming | null {
  if (!plan || !plan.enabled || !plan.segments.length || t === undefined) return null;
  const i = segmentIndexAt(plan, t);
  if (i < 0) return null;
  const seg = plan.segments[i]!;
  const cur = cropsOf(plan, seg, t);
  const prev = plan.segments[i - 1];
  const dur = Math.max(0, seg.dur ?? 0);
  const local = t - seg.start;
  const layout = layoutToKind(seg.layout);
  if (!prev || seg.transition === "cut" || dur <= 0 || local >= dur) {
    return { layout, primary: cur.primary, secondary: cur.secondary, index: i };
  }
  const raw = Math.max(0, Math.min(1, local / dur));
  const k = raw * raw * (3 - 2 * raw);
  const before = cropsOf(plan, prev, t);
  const boost = seg.transition === "zoom" ? 1 + Math.sin(Math.PI * raw) * 0.07 : 1;
  const primary = grow(mixCrop(before.primary, cur.primary, k), boost);
  const secondary =
    cur.secondary && before.secondary
      ? grow(mixCrop(before.secondary, cur.secondary, k), boost)
      : (cur.secondary ?? null);
  // durante a transição o layout do trecho anterior só muda no fim (evita piscada)
  const useLayout = layoutToKind(raw < 0.5 && prev.layout !== seg.layout ? prev.layout : seg.layout);
  return { layout: useLayout, primary, secondary, index: i };
}

/** true quando o plano realmente muda alguma coisa. */
export function hasFraming(p?: FramingPlan | null) {
  return Boolean(p?.enabled && p.segments.length);
}
