/**
 * Clipagem guiada por transcrição (estilo OpusClip).
 *
 * O motor de áudio (`clips.ts`) acha ENERGIA; este módulo acha SENTIDO.
 * A partir das legendas geradas por IA montamos frases completas e usamos
 * o texto para:
 *  1. definir início/fim do corte em fronteiras de frase (nunca no meio da palavra);
 *  2. pontuar gancho, curiosidade, pergunta/resposta e história completa;
 *  3. escrever o título do corte com as próprias palavras do vídeo;
 *  4. remover silêncios internos e criar zoom dinâmico ritmado pela fala.
 */

import type { CaptionCue } from "./captions";
import type { FrameKey, PreCrop, Segment } from "./preedit";

export interface Sentence {
  start: number;
  end: number;
  text: string;
}

/** Junta as palavras das legendas em frases (pontuação + pausa longa). */
export function cuesToSentences(cues: CaptionCue[], pauseBreak = 0.55): Sentence[] {
  const words = cues
    .flatMap((c) => c.words)
    .filter((w) => w.text.trim())
    .sort((a, b) => a.start - b.start);
  if (!words.length) return [];

  const out: Sentence[] = [];
  let buf: typeof words = [];
  let prevEnd = words[0]!.start;

  const flush = () => {
    if (!buf.length) return;
    out.push({
      start: buf[0]!.start,
      end: buf[buf.length - 1]!.end,
      text: buf.map((w) => w.text).join(" ").trim(),
    });
    buf = [];
  };

  for (const w of words) {
    if (buf.length && w.start - prevEnd >= pauseBreak) flush();
    buf.push(w);
    prevEnd = w.end;
    const endsSentence = /[.!?…]["')\]]?$/.test(w.text);
    const longEnough = buf.length >= 4;
    if (endsSentence && longEnough) flush();
    // frase gigante sem pontuação: quebra pelo tempo
    if (buf.length && buf[buf.length - 1]!.end - buf[0]!.start > 12) flush();
  }
  flush();
  return out.filter((s) => s.end - s.start >= 0.25);
}

const HOOK_OPENERS = [
  "você sabia", "voce sabia", "olha isso", "olha só", "presta atenção", "pare de",
  "nunca", "o segredo", "a verdade", "ninguém te conta", "ninguem te conta",
  "o erro", "o problema", "eu descobri", "imagina", "escuta", "isso muda",
  "did you know", "stop doing", "the secret", "nobody tells you", "here's why",
];
const CURIOSITY = [
  "porque", "por que", "motivo", "razão", "razao", "segredo", "erro", "verdade",
  "ninguém", "ninguem", "descobri", "resultado", "surpreende", "chocante",
  "na real", "acontece que", "o que ninguém",
];
const PAYOFF = [
  "então", "entao", "por isso", "resultado", "no final", "conclusão", "conclusao",
  "resumindo", "a lição", "a licao", "moral", "é isso", "e isso",
];
const CTA = ["comenta", "salva esse", "compartilha", "segue", "me diz", "link na bio"];
const FILLERS = ["ééé", "hum", "tipo assim", "né né", "aham"];

export interface TextScore {
  /** 0..1 — quão bom o TEXTO é como short */
  score: number;
  tags: string[];
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Pontua o texto de um candidato: gancho, curiosidade, história completa. */
export function scoreText(text: string): TextScore {
  const raw = text.trim();
  if (!raw) return { score: 0, tags: [] };
  const t = norm(raw);
  const head = norm(raw.slice(0, 140));
  const tail = norm(raw.slice(-140));
  const words = t.split(/\s+/).filter(Boolean);
  const tags: string[] = [];

  let hook = 0;
  if (HOOK_OPENERS.some((k) => head.includes(norm(k)))) hook += 0.6;
  if (/^[^.?!]{0,90}\?/.test(raw)) hook += 0.3; // abre com pergunta
  if (/\b\d+\b/.test(raw.slice(0, 90))) hook += 0.2; // "3 formas de..."
  hook = Math.min(1, hook);
  if (hook >= 0.5) tags.push("gancho de texto");

  const curiosity = Math.min(1, CURIOSITY.filter((k) => t.includes(norm(k))).length * 0.28);
  if (curiosity >= 0.5) tags.push("curiosidade");

  const questions = (raw.match(/\?/g) ?? []).length;
  const qa = questions > 0 && words.length > 25 ? Math.min(1, 0.45 + questions * 0.2) : questions * 0.3;
  if (qa >= 0.5) tags.push("pergunta e resposta");

  const payoff = PAYOFF.some((k) => tail.includes(norm(k))) ? 0.8 : /[.!?…]$/.test(raw) ? 0.5 : 0.15;
  if (payoff >= 0.8) tags.push("desfecho");
  if (CTA.some((k) => tail.includes(norm(k)))) tags.push("CTA");

  // história completa: começa em frase nova e não termina pendurado
  const danglingStart = /^(e|mas|que|porque|ai|aí|então|entao|ou|de|da|do)\b/i.test(raw);
  const danglingEnd = /\b(e|mas|que|porque|de|da|do|para|pra|com|um|uma|o|a)$/i.test(raw.replace(/[.!?…]+$/, ""));
  const completeness = (danglingStart ? 0 : 0.5) + (danglingEnd ? 0 : 0.5);
  if (completeness === 1) tags.push("frase completa");

  const filler = Math.min(0.5, FILLERS.filter((k) => t.includes(norm(k))).length * 0.15);
  // densidade textual: shorts bons falam muito em pouco tempo
  const richness = Math.min(1, words.length / 70);

  const score = Math.max(
    0,
    Math.min(
      1,
      hook * 0.34 +
        curiosity * 0.14 +
        qa * 0.12 +
        payoff * 0.14 +
        completeness * 0.16 +
        richness * 0.1 -
        filler,
    ),
  );
  return { score, tags };
}

/** Título curto a partir das próprias palavras do vídeo. */
export function titleFromText(text: string, max = 58): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const first =
    clean.split(/(?<=[.!?…])\s+/).find((s) => s.split(/\s+/).length >= 4) ?? clean;
  let out = first.replace(/^[,;:\-–—\s]+/, "").replace(/[.,;:\-–—\s]+$/, "");
  if (out.length > max) {
    out = out.slice(0, max);
    const cut = out.lastIndexOf(" ");
    if (cut > 20) out = out.slice(0, cut);
    out += "…";
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

export interface TranscriptWindow {
  start: number;
  end: number;
  text: string;
  text_score: number;
  tags: string[];
}

/** Janelas candidatas: blocos contíguos de frases dentro da duração pedida. */
export function transcriptWindows(
  sentences: Sentence[],
  minLen: number,
  maxLen: number,
): TranscriptWindow[] {
  const out: TranscriptWindow[] = [];
  for (let i = 0; i < sentences.length; i++) {
    let text = "";
    for (let j = i; j < sentences.length; j++) {
      const start = sentences[i]!.start;
      const end = sentences[j]!.end;
      text = text ? `${text} ${sentences[j]!.text}` : sentences[j]!.text;
      const len = end - start;
      if (len > maxLen * 1.12) break;
      if (len < minLen * 0.9) continue;
      const s = scoreText(text);
      out.push({ start, end, text, text_score: s.score, tags: s.tags });
    }
  }
  return out;
}

/**
 * Trechos mantidos dentro do corte, removendo os silêncios entre frases.
 * Devolve segmentos em tempo do vídeo original (compatível com `PreEdit.segments`).
 */
export function speechKeepSegments(
  sentences: Sentence[],
  clip: { start: number; end: number },
  opts: { minGap?: number; pad?: number } = {},
): Segment[] {
  const minGap = opts.minGap ?? 0.45;
  const pad = opts.pad ?? 0.12;
  const inside = sentences
    .filter((s) => s.end > clip.start + 0.05 && s.start < clip.end - 0.05)
    .map((s) => ({
      start: Math.max(clip.start, s.start - pad),
      end: Math.min(clip.end, s.end + pad),
    }))
    .sort((a, b) => a.start - b.start);
  if (!inside.length) return [];

  const merged: Segment[] = [];
  for (const s of inside) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < minGap) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  const kept = merged.filter((s) => s.end - s.start >= 0.2);
  const removed = clip.end - clip.start - kept.reduce((a, s) => a + (s.end - s.start), 0);
  // se quase nada seria removido, não vale bagunçar o corte
  return removed < 0.4 ? [] : kept;
}

/**
 * Zoom dinâmico: alterna enquadramento aberto e fechado a cada frase,
 * dando ritmo visual sem depender de B-roll externo.
 */
export function zoomKeys(
  sentences: Sentence[],
  clip: { start: number; end: number },
  base: PreCrop | null,
  opts: { intensity?: number; minHold?: number } = {},
): FrameKey[] {
  const intensity = Math.max(0.02, Math.min(0.18, opts.intensity ?? 0.09));
  const minHold = opts.minHold ?? 2.2;
  const b: PreCrop = base ?? { x: 0, y: 0, w: 1, h: 1 };

  const marks = sentences
    .map((s) => s.start)
    .filter((t) => t >= clip.start && t <= clip.end - 0.8);
  const times: number[] = [clip.start];
  for (const t of marks) {
    if (t - times[times.length - 1]! >= minHold) times.push(t);
  }
  if (times.length < 2) return [];

  const zoomed = (z: number): PreCrop => {
    const w = Math.min(1, Math.max(0.2, b.w * (1 - z)));
    const h = Math.min(1, Math.max(0.2, b.h * (1 - z)));
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return {
      x: Math.min(1 - w, Math.max(0, cx - w / 2)),
      y: Math.min(1 - h, Math.max(0, cy - h / 2)),
      w,
      h,
    };
  };

  return times.map((t, i) => ({ t, crop: zoomed(i % 2 === 0 ? 0 : intensity) }));
}
