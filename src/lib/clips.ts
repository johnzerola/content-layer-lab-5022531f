/**
 * Clipagem automática estilo OpusClip.
 *
 * Pipeline (inspirado nos projetos open-source de auto-clipping mais usados —
 * auto-editor, ClipsAI, vid2clip: detecção de silêncio → segmentação de fala →
 * janelas candidatas → score multi-sinal → seleção com diversidade):
 *
 *  1. curva de loudness (RMS, hop 100 ms) + curva de movimento (frames 64px)
 *  2. detecção de silêncio com limiar adaptativo (percentil do ruído de fundo)
 *  3. agrupamento em segmentos de fala (sentence-like), com pausas como fronteiras
 *  4. janelas candidatas alinhadas às fronteiras (nunca corta no meio da frase)
 *  5. score = gancho (início forte) + energia média + dinâmica + movimento +
 *     densidade de fala + preferência de duração + posição no vídeo
 *  6. seleção gulosa com penalidade de proximidade (MMR) para dar variedade
 *
 * Tudo roda no navegador — nada é enviado para servidor.
 */

export interface Clip {
  start: number;
  end: number;
  /** 0..100 — potencial viral estimado */
  score: number;
  /** título curto sugerido para o corte */
  title?: string;
  /** motivo/descrição do porquê o trecho foi escolhido */
  reason?: string;
  /** rótulos do que o algoritmo detectou (gancho, pico de energia, etc.) */
  tags?: string[];
}

export interface ClipOptions {
  /** duração alvo (compat) — usada quando min/max não são informados */
  target?: number;
  /** duração mínima de cada corte, em segundos */
  minLen?: number;
  /** duração máxima de cada corte, em segundos */
  maxLen?: number;
  /** quantidade máxima de cortes */
  max?: number;
  /** 0..100 — só devolve cortes com score igual ou acima */
  minScore?: number;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
}

const HOP = 0.1; // 100 ms

interface AudioAnalysis {
  rms: number[];
  duration: number;
}

async function loudnessCurve(file: File, step = HOP): Promise<AudioAnalysis> {
  const buf = await file.arrayBuffer();
  const tmp = new (window.AudioContext ?? window.webkitAudioContext)();
  let audio: AudioBuffer;
  try {
    audio = await tmp.decodeAudioData(buf.slice(0));
  } finally {
    void tmp.close();
  }

  const data = audio.getChannelData(0);
  const rate = audio.sampleRate;
  const win = Math.max(1, Math.round(step * rate));
  const rms: number[] = [];
  for (let i = 0; i < data.length; i += win) {
    let sum = 0;
    const end = Math.min(data.length, i + win);
    for (let j = i; j < end; j++) sum += data[j]! * data[j]!;
    rms.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return { rms, duration: audio.duration };
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

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i] ?? 0;
}

export interface SpeechSegment {
  start: number;
  end: number;
}

/**
 * Detecta trechos com fala usando limiar adaptativo (percentil 20 do RMS como
 * piso de ruído). Pausas menores que `bridge` não quebram o segmento.
 */
export function speechSegments(rms: number[], hop = HOP, bridge = 0.35, minLen = 0.4): SpeechSegment[] {
  if (!rms.length) return [];
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.2);
  const loud = percentile(sorted, 0.9);
  const thr = floor + (loud - floor) * 0.18;

  const segs: SpeechSegment[] = [];
  let start = -1;
  let quiet = 0;
  for (let i = 0; i < rms.length; i++) {
    const active = (rms[i] ?? 0) > thr;
    if (active) {
      if (start < 0) start = i;
      quiet = 0;
    } else if (start >= 0) {
      quiet += hop;
      if (quiet >= bridge) {
        const end = (i + 1) * hop - quiet;
        if (end - start * hop >= minLen) segs.push({ start: start * hop, end });
        start = -1;
        quiet = 0;
      }
    }
  }
  if (start >= 0) {
    const end = rms.length * hop;
    if (end - start * hop >= minLen) segs.push({ start: start * hop, end });
  }
  return segs;
}

/** Fronteiras "seguras" de corte: início/fim de cada segmento de fala. */
function boundaries(segs: SpeechSegment[], duration: number) {
  const starts = new Set<number>([0]);
  const ends = new Set<number>([duration]);
  for (const s of segs) {
    starts.add(Math.max(0, s.start - 0.15));
    ends.add(Math.min(duration, s.end + 0.25));
  }
  return {
    starts: [...starts].sort((a, b) => a - b),
    ends: [...ends].sort((a, b) => a - b),
  };
}

function nearest(list: number[], v: number, tolerance: number) {
  let best = v;
  let bestD = tolerance;
  for (const x of list) {
    const d = Math.abs(x - v);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return best;
}

interface Candidate {
  start: number;
  end: number;
  raw: number;
  hook: number;
  energy: number;
  dynamics: number;
  motion: number;
  density: number;
  tags: string[];
}

const HOOK_LABELS = [
  "Gancho forte na abertura",
  "Pico de energia no meio",
  "Trecho com muita reação",
  "Explicação completa e direta",
  "Momento com virada de assunto",
  "Fecho com chamada natural",
];

function describe(c: Candidate, index: number, duration: number) {
  const pos = c.start / Math.max(1, duration);
  const tags = c.tags;
  const title =
    tags.includes("gancho")
      ? HOOK_LABELS[0]!
      : tags.includes("pico")
        ? HOOK_LABELS[1]!
        : tags.includes("reação")
          ? HOOK_LABELS[2]!
          : pos < 0.15
            ? HOOK_LABELS[4]!
            : pos > 0.8
              ? HOOK_LABELS[5]!
              : HOOK_LABELS[3]!;

  const parts: string[] = [];
  if (c.hook > 0.6) parts.push("abre com fala forte nos primeiros segundos");
  if (c.dynamics > 0.55) parts.push("boa variação de tom (não fica monótono)");
  if (c.motion > 0.5) parts.push("bastante movimento em cena");
  if (c.density > 0.7) parts.push("fala contínua, quase sem pausas");
  if (!parts.length) parts.push("trecho estável, bom para legenda e recorte vertical");

  return {
    title: `${title} · #${index + 1}`,
    reason: parts.join(" · "),
  };
}

/** Encontra os melhores trechos de um vídeo longo. */
export async function findClips(file: File, opts: ClipOptions = {}): Promise<Clip[]> {
  const target = Math.max(3, opts.target ?? 30);
  const minLen = Math.max(3, opts.minLen ?? target);
  const maxLen = Math.max(minLen, opts.maxLen ?? target);
  const max = Math.max(1, opts.max ?? 8);
  const minScore = Math.min(100, Math.max(0, opts.minScore ?? 0));

  let rms: number[] = [];
  let duration = 0;
  try {
    const l = await loudnessCurve(file);
    rms = l.rms;
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

  const motion = await motionCurve(file, Math.min(90, Math.max(16, Math.round(duration / 3))), opts.signal);
  opts.onProgress?.(0.8);

  if (duration <= minLen * 1.2) {
    return [{ start: 0, end: duration, score: 72, title: "Vídeo inteiro", reason: "curto demais para cortar", tags: [] }];
  }

  const segs = speechSegments(rms);
  const { starts, ends } = boundaries(segs, duration);

  // normalizadores
  const sortedRms = [...rms].sort((a, b) => a - b);
  const loudRef = Math.max(1e-6, percentile(sortedRms, 0.95));
  const sortedMotion = [...motion].sort((a, b) => a - b);
  const motionRef = Math.max(1e-6, percentile(sortedMotion, 0.9));

  const speechAt = (t: number) => segs.some((s) => t >= s.start && t <= s.end);

  const lens: number[] = [];
  const steps = maxLen > minLen ? 5 : 1;
  for (let i = 0; i < steps; i++) {
    const len = steps === 1 ? minLen : minLen + ((maxLen - minLen) * i) / (steps - 1);
    if (len <= duration) lens.push(Number(len.toFixed(2)));
  }
  if (!lens.length) lens.push(Math.min(minLen, duration));

  const step = 0.5;
  const sweet = (minLen + maxLen) / 2;
  const cands: Candidate[] = [];

  for (const len of lens) {
    for (let s0 = 0; s0 + len <= duration; s0 += step) {
      // alinha às fronteiras de fala para não cortar no meio da frase
      const s = nearest(starts, s0, 1.2);
      const e = Math.min(duration, nearest(ends, s + len, 1.5));
      const realLen = e - s;
      if (realLen < minLen * 0.85 || realLen > maxLen * 1.15) continue;

      let sum = 0;
      let peak = 0;
      let low = Infinity;
      let mot = 0;
      let voiced = 0;
      let n = 0;
      let hook = 0;
      for (let t = s; t < e; t += step) {
        const a = at(rms, t, duration) / loudRef;
        const m = at(motion, t, duration) / motionRef;
        sum += a;
        mot += m;
        peak = Math.max(peak, a);
        low = Math.min(low, a);
        if (speechAt(t)) voiced++;
        if (t - s < 3) hook = Math.max(hook, a);
        n++;
      }
      if (!n) continue;
      const energy = Math.min(1, sum / n);
      const dynamics = Math.min(1, Math.max(0, peak - (low === Infinity ? 0 : low)));
      const motionAvg = Math.min(1, mot / n);
      const density = voiced / n;
      const lenFit = 1 - Math.min(1, Math.abs(realLen - sweet) / Math.max(1, maxLen));
      // OpusClip evita o começo "de aquecimento" do vídeo
      const posBonus = s / duration < 0.05 ? 0.85 : 1;

      const raw =
        (hook * 0.26 + energy * 0.24 + dynamics * 0.16 + density * 0.18 + motionAvg * 0.1 + lenFit * 0.06) * posBonus;

      const tags: string[] = [];
      if (hook > 0.65) tags.push("gancho");
      if (peak > 0.9) tags.push("pico");
      if (motionAvg > 0.55) tags.push("reação");
      if (density > 0.75) tags.push("fala contínua");

      cands.push({
        start: s,
        end: e,
        raw,
        hook,
        energy,
        dynamics,
        motion: motionAvg,
        density,
        tags,
      });
    }
  }

  if (!cands.length) {
    return [
      {
        start: 0,
        end: Math.min(minLen, duration),
        score: 62,
        title: "Início do vídeo",
        reason: "não foi possível analisar a fala — usando o começo",
        tags: [],
      },
    ];
  }

  cands.sort((a, b) => b.raw - a.raw);
  const best = cands[0]!.raw;
  const worst = cands[cands.length - 1]!.raw;
  const span = Math.max(1e-6, best - worst);
  const scoreOf = (raw: number) => Math.round(52 + ((raw - worst) / span) * 47);

  // seleção gulosa com diversidade (MMR): penaliza candidatos perto dos já escolhidos
  const chosen: Candidate[] = [];
  for (const c of cands) {
    if (chosen.length >= max) break;
    if (scoreOf(c.raw) < minScore) continue;
    const overlaps = chosen.some((x) => c.start < x.end - 0.5 && x.start < c.end - 0.5);
    if (overlaps) continue;
    const tooClose = chosen.some((x) => Math.abs(x.start - c.start) < Math.max(minLen, 8) * 0.6);
    if (tooClose) continue;
    chosen.push(c);
  }

  const clips = chosen
    .sort((a, b) => a.start - b.start)
    .map((c, i) => {
      const meta = describe(c, i, duration);
      return {
        start: Number(c.start.toFixed(2)),
        end: Number(Math.min(duration, c.end).toFixed(2)),
        score: scoreOf(c.raw),
        title: meta.title,
        reason: meta.reason,
        tags: c.tags,
      };
    });

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
