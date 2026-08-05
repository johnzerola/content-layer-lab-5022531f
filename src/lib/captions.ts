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
  let buf: AudioBuffer;
  try {
    buf = await decodeMono(file);
  } catch {
    throw new Error(
      "Não consegui ler o áudio deste vídeo. Ele pode estar sem faixa de áudio ou em um codec que o navegador não decodifica — exporte em MP4/AAC e tente de novo.",
    );
  }

  const from = Math.max(0, opts.clip?.start ?? 0);
  const to = Math.min(buf.duration, opts.clip?.end ?? buf.duration);
  if (to - from < 0.4) {
    throw new Error("O trecho selecionado é curto demais para transcrever (mínimo 0,4s). Aumente o corte.");
  }

  // validação de áudio: silêncio total / faixa muda
  const ch = buf.getChannelData(0);
  let peak = 0;
  let energy = 0;
  const i0 = Math.floor(from * SR);
  const i1 = Math.min(ch.length, Math.floor(to * SR));
  for (let i = i0; i < i1; i += 7) {
    const v = Math.abs(ch[i] ?? 0);
    if (v > peak) peak = v;
    energy += v;
  }
  const avg = energy / Math.max(1, Math.floor((i1 - i0) / 7));
  if (peak < 0.005) {
    throw new Error("Este vídeo está mudo (sem sinal de áudio no trecho). Sem fala não dá para gerar legendas.");
  }
  if (avg < 0.0015) {
    throw new Error(
      "O áudio está baixo demais para transcrever com segurança. Aumente o volume do arquivo original e tente novamente.",
    );
  }

  const segments = findSegments(buf, from, to);
  if (!segments.length) {
    throw new Error(
      "Não detectei fala neste trecho — parece só música ou ruído. Ajuste o corte para uma parte falada e tente de novo.",
    );
  }

  const cues: CaptionCue[] = [];
  let done = 0;
  let lastErr: string | null = null;
  let failures = 0;
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
      failures++;
      lastErr = String((err as Error)?.message ?? err);
      console.warn("segmento sem transcrição", err);
      // erros de conta/limite não adianta insistir nos próximos segmentos
      if (/crédito|limite|indisponível/i.test(lastErr)) throw new Error(lastErr);
    }
    done++;
    opts.onProgress?.({ done, total: segments.length });
  }

  if (!cues.length) {
    throw new Error(
      failures
        ? `A transcrição falhou em todos os ${failures} trechos. ${lastErr ?? ""}`.trim()
        : "A transcrição voltou vazia — o áudio tem fala, mas nada foi reconhecido. Tente trocar o idioma para 'auto'.",
    );
  }
  return cues;
}


export function cuesToText(cues: CaptionCue[]) {
  return cues.map((c) => c.words.map((w) => w.text).join(" ")).join(" ");
}

/** Legenda de exemplo pra prévia enquanto não há transcrição real. */
export function demoCues(text = "isso aqui muda o seu jogo agora mesmo"): CaptionCue[] {
  const words = text.split(" ");
  const step = 0.42;
  return [
    {
      start: 0,
      end: words.length * step,
      words: words.map((t, i) => ({ text: t, start: i * step, end: (i + 1) * step - 0.02 })),
    },
  ];
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
