import { transcribeChunk } from "./transcribe.functions";

export interface CaptionWord {
  start: number;
  end: number;
  text: string;
}

export interface CaptionCue {
  start: number;
  end: number;
  words: CaptionWord[];
}

/** Segmento de fala detectado por energia do áudio. */
interface Segment {
  start: number;
  end: number;
}

const SR = 16000;

async function decodeMono(file: File): Promise<AudioBuffer> {
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctx();
  const decoded = await ac.decodeAudioData(await file.arrayBuffer());
  void ac.close();
  const len = Math.max(1, Math.floor((decoded.duration * SR)));
  const off = new OfflineAudioContext(1, len, SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

/** Detecta trechos com fala (VAD simples por RMS). */
function findSegments(buf: AudioBuffer, from: number, to: number): Segment[] {
  const data = buf.getChannelData(0);
  const frame = Math.floor(SR * 0.02);
  const i0 = Math.floor(from * SR);
  const i1 = Math.min(data.length, Math.floor(to * SR));

  const rms: number[] = [];
  for (let i = i0; i < i1; i += frame) {
    let sum = 0;
    const end = Math.min(i1, i + frame);
    for (let j = i; j < end; j++) sum += data[j]! * data[j]!;
    rms.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  if (!rms.length) return [];
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const peak = sorted[Math.floor(sorted.length * 0.95)] ?? 0.1;
  const thr = Math.max(0.006, floor + (peak - floor) * 0.18);

  const segs: Segment[] = [];
  let start = -1;
  for (let k = 0; k < rms.length; k++) {
    const t = from + k * 0.02;
    if (rms[k]! > thr) {
      if (start < 0) start = t;
    } else if (start >= 0 && t - start > 0.25) {
      segs.push({ start, end: t });
      start = -1;
    } else if (start >= 0 && t - start > 0.05) {
      // silêncio curto: mantém o segmento aberto
    }
  }
  if (start >= 0) segs.push({ start, end: to });

  // junta segmentos próximos e limita a 14s
  const merged: Segment[] = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start - last.end < 0.45 && s.end - last.start <= 14) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged
    .map((s) => ({ start: Math.max(from, s.start - 0.12), end: Math.min(to, s.end + 0.2) }))
    .filter((s) => s.end - s.start >= 0.35);
}

function encodeWav(buf: AudioBuffer, from: number, to: number): Uint8Array {
  const data = buf.getChannelData(0);
  const i0 = Math.max(0, Math.floor(from * SR));
  const i1 = Math.min(data.length, Math.floor(to * SR));
  const n = Math.max(0, i1 - i0);
  const out = new ArrayBuffer(44 + n * 2);
  const view = new DataView(out);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SR, true);
  view.setUint32(28, SR * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, data[i0 + i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(out);
}

function toBase64(bytes: Uint8Array) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Distribui as palavras dentro do segmento proporcionalmente ao tamanho de cada uma. */
function wordsFor(text: string, seg: Segment): CaptionWord[] {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const weights = parts.map((p) => p.length + 1.5);
  const total = weights.reduce((a, b) => a + b, 0);
  const dur = Math.max(0.2, seg.end - seg.start);
  let t = seg.start;
  return parts.map((p, i) => {
    const d = (weights[i]! / total) * dur;
    const w = { start: t, end: t + d, text: p };
    t += d;
    return w;
  });
}

export interface CaptionProgress {
  done: number;
  total: number;
}

/** Gera legendas com tempo por palavra para o trecho pedido do vídeo. */
export async function generateCaptions(
  file: File,
  opts: {
    clip?: { start: number; end: number } | undefined;
    language?: string | undefined;
    onProgress?: ((p: CaptionProgress) => void) | undefined;
    signal?: AbortSignal | undefined;
  } = {},
): Promise<CaptionCue[]> {
  const buf = await decodeMono(file);
  const from = Math.max(0, opts.clip?.start ?? 0);
  const to = Math.min(buf.duration, opts.clip?.end ?? buf.duration);
  const segments = findSegments(buf, from, to);
  if (!segments.length) return [];

  const cues: CaptionCue[] = [];
  let done = 0;
  for (const seg of segments) {
    if (opts.signal?.aborted) throw new DOMException("cancelado", "AbortError");
    const wav = encodeWav(buf, seg.start, seg.end);
    try {
      const res = await transcribeChunk({
        data: { audio: toBase64(wav), ...(opts.language ? { language: opts.language } : {}) },
      });
      const words = wordsFor(res.text ?? "", seg);
      if (words.length) cues.push({ start: seg.start, end: seg.end, words });
    } catch (err) {
      console.warn("segmento sem transcrição", err);
    }
    done++;
    opts.onProgress?.({ done, total: segments.length });
  }
  return cues;
}

export function cuesToText(cues: CaptionCue[]) {
  return cues.map((c) => c.words.map((w) => w.text).join(" ")).join(" ");
}

/** Exporta as legendas em SRT (útil pra subir junto no editor de terceiros). */
export function cuesToSrt(cues: CaptionCue[]) {
  const fmt = (s: number) => {
    const ms = Math.floor((s % 1) * 1000);
    const total = Math.floor(s);
    const hh = String(Math.floor(total / 3600)).padStart(2, "0");
    const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
  };
  return cues
    .map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.words.map((w) => w.text).join(" ")}\n`)
    .join("\n");
}

/** Desloca os tempos das legendas conforme trim/velocidade da saída. */
export function shiftCues(cues: CaptionCue[], offset: number, speed: number): CaptionCue[] {
  const f = (t: number) => (t - offset) / speed;
  return cues.map((c) => ({
    start: f(c.start),
    end: f(c.end),
    words: c.words.map((w) => ({ ...w, start: f(w.start), end: f(w.end) })),
  }));
}
