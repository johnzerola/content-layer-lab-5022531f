/**
 * Clipagem automática estilo OpusClip: analisa a energia do áudio (fala/música)
 * e o movimento visual para escolher os melhores trechos de um vídeo longo.
 * Tudo roda no navegador — nada é enviado para servidor.
 */

export interface Clip {
  start: number;
  end: number;
  /** 0..100 — potencial viral estimado */
  score: number;
}

export interface ClipOptions {
  /** duração alvo de cada corte, em segundos */
  target?: number;
  /** quantidade máxima de cortes */
  max?: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

async function loudnessCurve(file: File, step = 0.25): Promise<{ curve: number[]; duration: number }> {
  const Ctx = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
  const buf = await file.arrayBuffer();
  const tmp = new (window.AudioContext ?? window.webkitAudioContext)();
  let audio: AudioBuffer;
  try {
    audio = await tmp.decodeAudioData(buf.slice(0));
  } finally {
    void tmp.close();
  }
  if (!Ctx) return { curve: [], duration: audio.duration };

  const data = audio.getChannelData(0);
  const rate = audio.sampleRate;
  const win = Math.max(1, Math.round(step * rate));
  const curve: number[] = [];
  for (let i = 0; i < data.length; i += win) {
    let sum = 0;
    const end = Math.min(data.length, i + win);
    for (let j = i; j < end; j++) sum += data[j]! * data[j]!;
    curve.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return { curve, duration: audio.duration };
}

/** Energia visual: diferença média entre quadros amostrados. */
async function motionCurve(file: File, samples: number, signal?: AbortSignal): Promise<number[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  try {
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("vídeo ilegível"));
    });
    const w = 64;
    const h = Math.max(16, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * w));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const out: number[] = [];
    let prev: Uint8ClampedArray | null = null;
    for (let i = 0; i < samples; i++) {
      if (signal?.aborted) break;
      video.currentTime = ((i + 0.5) / samples) * video.duration;
      await new Promise<void>((res) => {
        video.onseeked = () => res();
      });
      ctx.drawImage(video, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h).data;
      if (prev) {
        let diff = 0;
        for (let k = 0; k < px.length; k += 16) diff += Math.abs(px[k]! - prev[k]!);
        out.push(diff / (px.length / 16) / 255);
      } else {
        out.push(0);
      }
      prev = new Uint8ClampedArray(px);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function at(curve: number[], t: number, duration: number) {
  if (!curve.length || !duration) return 0;
  const i = Math.min(curve.length - 1, Math.max(0, Math.floor((t / duration) * curve.length)));
  return curve[i] ?? 0;
}

/** Encontra os melhores trechos de um vídeo longo. */
export async function findClips(file: File, opts: ClipOptions = {}): Promise<Clip[]> {
  const target = Math.max(5, opts.target ?? 30);
  const max = Math.max(1, opts.max ?? 8);

  let curve: number[] = [];
  let duration = 0;
  try {
    const l = await loudnessCurve(file);
    curve = l.curve;
    duration = l.duration;
  } catch {
    /* sem áudio: usa só movimento */
  }
  opts.onProgress?.(0.4);

  if (!duration) {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error("vídeo ilegível"));
    });
    duration = v.duration;
    URL.revokeObjectURL(url);
  }

  const motion = await motionCurve(file, Math.min(60, Math.max(12, Math.round(duration / 4))), opts.signal);
  opts.onProgress?.(0.85);

  if (duration <= target * 1.2) {
    return [{ start: 0, end: duration, score: 70 }];
  }

  // janela deslizante de meio segundo
  const step = 0.5;
  const windows: { start: number; raw: number }[] = [];
  for (let s = 0; s + target <= duration; s += step) {
    let sum = 0;
    let peak = 0;
    for (let t = s; t < s + target; t += step) {
      const energy = at(curve, t, duration) * 0.7 + at(motion, t, duration) * 0.3;
      sum += energy;
      peak = Math.max(peak, energy);
    }
    const n = target / step;
    // média alta + um pico forte = trecho com gancho
    windows.push({ start: s, raw: (sum / n) * 0.75 + peak * 0.25 });
  }
  if (!windows.length) return [{ start: 0, end: Math.min(target, duration), score: 60 }];

  windows.sort((a, b) => b.raw - a.raw);
  const chosen: { start: number; raw: number }[] = [];
  for (const w of windows) {
    if (chosen.length >= max) break;
    // sem sobreposição maior que 30%
    if (chosen.some((c) => Math.abs(c.start - w.start) < target * 0.7)) continue;
    chosen.push(w);
  }

  const best = chosen[0]?.raw ?? 1;
  const worst = windows[windows.length - 1]?.raw ?? 0;
  const span = Math.max(1e-6, best - worst);
  const clips = chosen
    .map((c) => ({
      start: Number(c.start.toFixed(2)),
      end: Number(Math.min(duration, c.start + target).toFixed(2)),
      score: Math.round(55 + ((c.raw - worst) / span) * 44),
    }))
    .sort((a, b) => a.start - b.start);

  opts.onProgress?.(1);
  return clips;
}

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  }
}
