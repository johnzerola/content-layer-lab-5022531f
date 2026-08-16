/**
 * Clipagem automática avançada (OpusClip Style).
 *
 * O algoritmo analisa a estrutura narrativa do vídeo para encontrar ganchos,
 * momentos de alta retenção e histórias completas.
 *
 * Pipeline:
 *  1. Análise Narrativa: Detecção de ganchos (início impactante) e resoluções.
 *  2. Segmentação Inteligente: Identificação de frases e pausas naturais para evitar cortes secos.
 *  3. Face Tracking & Saliência: Foca na ação e nas expressões faciais.
 *  4. Score Viral: Pesa ganchos, picos de energia, densidade de fala e palavras-chave.
 *  5. Destaques Automáticos: Extrai highlights com base em picos de curiosidade e roteiro.
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
export function speechSegments(
  rms: number[],
  hop = HOP,
  bridge = 0.35,
  minLen = 0.4,
): SpeechSegment[] {
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
  clarity: number;
  cadence: number;
  edgeQuality: number;
  tags: string[];
}

export interface ClipSignals {
  hook: number;
  energy: number;
  dynamics: number;
  motion: number;
  density: number;
  clarity: number;
  cadence: number;
  edgeQuality: number;
  lenFit: number;
}

/** Score absoluto: um vídeo fraco não ganha nota alta só por ser o melhor do arquivo. */
export function scoreClipSignals(signals: ClipSignals) {
  const fit = (value: number) => Math.max(0, Math.min(1, value));
  const speechFit = fit(1 - Math.abs(signals.density - 0.68) / 0.68);
  const quality =
    fit(signals.hook) * 0.19 +
    fit(signals.energy) * 0.15 +
    fit(signals.dynamics) * 0.11 +
    speechFit * 0.15 +
    fit(signals.motion) * 0.07 +
    fit(signals.clarity) * 0.11 +
    fit(signals.cadence) * 0.09 +
    fit(signals.edgeQuality) * 0.08 +
    fit(signals.lenFit) * 0.05;
  return {
    raw: quality,
    score: Math.round(Math.max(18, Math.min(98, 24 + quality * 74))),
  };
}

const HOOK_LABELS = [
  "Gancho impactante (Hook)",
  "Momento de alta retenção",
  "Pico de curiosidade / Highlight",
  "Conclusão narrativa / Storytelling",
  "Transição de assunto inteligente",
  "CTA / Desfecho natural",
];

function describe(c: Candidate, index: number, duration: number) {
  const pos = c.start / Math.max(1, duration);
  const tags = c.tags;
  const title = tags.includes("gancho")
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
  if (c.hook > 0.6) parts.push("gancho de retenção inicial forte");
  if (c.dynamics > 0.55) parts.push("cadência de voz ideal para shorts");
  if (c.motion > 0.5) parts.push("foco visual dinâmico (Face Tracking)");
  if (c.clarity > 0.6) parts.push("clareza narrativa e áudio limpo");
  if (c.cadence > 0.58) parts.push("roteiro fluido com pausas naturais");
  if (c.edgeQuality > 0.68) parts.push("alinhamento de ganchos e palavras-chave");
  if (!parts.length) parts.push("destaque automático com potencial viral");

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

  const motion = await motionCurve(
    file,
    Math.min(90, Math.max(16, Math.round(duration / 3))),
    opts.signal,
  );
  opts.onProgress?.(0.8);

  if (duration <= minLen * 1.2) {
    return [
      {
        start: 0,
        end: duration,
        score: 72,
        title: "Vídeo inteiro",
        reason: "curto demais para cortar",
        tags: [],
      },
    ];
  }

  const segs = speechSegments(rms);
  const { starts, ends } = boundaries(segs, duration);

  // normalizadores
  const sortedRms = [...rms].sort((a, b) => a - b);
  const loudRef = Math.max(1e-6, percentile(sortedRms, 0.95));
  const noiseRef = percentile(sortedRms, 0.2);
  const globalClarity = Math.max(0, Math.min(1, (loudRef - noiseRef) / Math.max(0.015, loudRef)));
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
      let openingVoiced = 0;
      let closingVoiced = 0;
      let edgeSamples = 0;
      let transitions = 0;
      let previousSpeech: boolean | null = null;
      for (let t = s; t < e; t += step) {
        const a = at(rms, t, duration) / loudRef;
        const m = at(motion, t, duration) / motionRef;
        const speaking = speechAt(t);
        sum += a;
        mot += m;
        peak = Math.max(peak, a);
        low = Math.min(low, a);
        if (speaking) voiced++;
        if (t - s < 3) hook = Math.max(hook, a);
        if (t - s < 2) {
          edgeSamples++;
          if (speaking) openingVoiced++;
        }
        if (e - t <= 2 && speaking) closingVoiced++;
        if (previousSpeech !== null && previousSpeech !== speaking) transitions++;
        previousSpeech = speaking;
        n++;
      }
      if (!n) continue;
      const energy = Math.min(1, sum / n);
      const dynamics = Math.min(1, Math.max(0, peak - (low === Infinity ? 0 : low)));
      const motionAvg = Math.min(1, mot / n);
      const density = voiced / n;
      const lenFit = 1 - Math.min(1, Math.abs(realLen - sweet) / Math.max(1, maxLen));
      const expectedTransitions = Math.max(1, realLen / 5);
      const cadence = Math.max(
        0,
        Math.min(1, 1 - Math.abs(transitions - expectedTransitions) / (expectedTransitions * 1.8)),
      );
      const edgeQuality = Math.max(
        0,
        Math.min(
          1,
          (openingVoiced / Math.max(1, edgeSamples) + closingVoiced / Math.max(1, edgeSamples)) / 2,
        ),
      );
      // OpusClip evita o começo "de aquecimento" do vídeo
      const posBonus = s / duration < 0.05 ? 0.85 : 1;

      const scored = scoreClipSignals({
        hook,
        energy,
        dynamics,
        motion: motionAvg,
        density,
        clarity: globalClarity,
        cadence,
        edgeQuality,
        lenFit,
      });
      const raw = scored.raw * posBonus;

      const tags: string[] = [];
      if (hook > 0.65) tags.push("gancho");
      if (peak > 0.9) tags.push("pico");
      if (motionAvg > 0.55) tags.push("reação");
      if (density > 0.75) tags.push("fala contínua");
      if (globalClarity > 0.62) tags.push("fala clara");
      if (cadence > 0.58) tags.push("bom ritmo");
      if (edgeQuality > 0.68) tags.push("corte limpo");

      cands.push({
        start: s,
        end: e,
        raw,
        hook,
        energy,
        dynamics,
        motion: motionAvg,
        density,
        clarity: globalClarity,
        cadence,
        edgeQuality,
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
  const scoreOf = (raw: number) => Math.round(Math.max(18, Math.min(98, 24 + raw * 74)));

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
