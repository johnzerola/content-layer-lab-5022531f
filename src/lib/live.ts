/**
 * Monitor de lives (X/Twitter) com cortes automáticos.
 *
 * Fluxo: o servidor descobre o playlist HLS da transmissão → o navegador toca
 * a live num <video> oculto (via hls.js + proxy) → um MediaRecorder grava a
 * captura em blocos contínuos, e cada bloco vira um corte pontuado por energia
 * de áudio e movimento — igual ao CorteIA, só que ao vivo.
 */

export interface LiveClip {
  id: string;
  blob: Blob;
  url: string;
  /** segundos desde o início do monitoramento */
  at: number;
  duration: number;
  /** 0..100 */
  score: number;
  title: string;
  reason?: string;
  tags?: string[];
  /** recorte sugerido automaticamente e ajustável no editor */
  trim?: { start: number; end: number };
}

export interface LiveClipAnalysis {
  score: number;
  trim: { start: number; end: number };
  reason: string;
  tags: string[];
  metrics: {
    speech: number;
    clarity: number;
    hook: number;
    cadence: number;
  };
}

export function hlsProxyUrl(url: string) {
  return `/api/public/hls-proxy?t=${encodeURIComponent(url)}`;
}

export function pickRecorderMime(): string {
  const list = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const m of list) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/** Liga o <video> ao playlist HLS. Devolve uma função para desligar. */
export async function attachHls(video: HTMLVideoElement, playlist: string): Promise<() => void> {
  const { signedHlsProxyUrl } = await import("@/lib/live.functions");
  const src = await signedHlsProxyUrl({ data: { url: playlist } });
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    await video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }
  const { default: Hls } = await import("hls.js");
  if (!Hls.isSupported()) throw new Error("Este navegador não consegue tocar HLS.");
  const hls = new Hls({ lowLatencyMode: true, enableWorker: true, liveSyncDurationCount: 3 });
  hls.loadSource(src);
  hls.attachMedia(video);
  await new Promise<void>((resolve) => {
    hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
    window.setTimeout(resolve, 8000);
  });
  await video.play().catch(() => undefined);
  return () => {
    hls.destroy();
  };
}

export interface RecorderOptions {
  /** duração de cada corte automático, em segundos */
  clipLen: number;
  onClip: (blob: Blob, at: number, duration: number) => void;
  onError?: (message: string) => void;
}

/** Gravador contínuo: fecha um arquivo a cada `clipLen` segundos. */
export class LiveClipper {
  private rec: MediaRecorder | null = null;
  private timer: number | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private t0 = 0;
  private stopped = false;

  constructor(
    private stream: MediaStream,
    private opts: RecorderOptions,
  ) {}

  start() {
    this.stopped = false;
    this.t0 = performance.now();
    this.cycle();
  }

  /** força fechar o corte atual agora (e começa o próximo) */
  cutNow() {
    if (this.rec && this.rec.state === "recording") this.rec.stop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    if (this.rec && this.rec.state === "recording") this.rec.stop();
    this.rec = null;
  }

  private cycle() {
    if (this.stopped) return;
    const mime = pickRecorderMime();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(
        this.stream,
        mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined,
      );
    } catch (e) {
      this.opts.onError?.(e instanceof Error ? e.message : "não foi possível gravar a live");
      return;
    }
    this.rec = rec;
    this.chunks = [];
    this.startedAt = (performance.now() - this.t0) / 1000;

    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
    };
    rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: mime || "video/webm" });
      const dur = (performance.now() - this.t0) / 1000 - this.startedAt;
      if (blob.size > 40_000 && dur > 2) this.opts.onClip(blob, this.startedAt, dur);
      if (!this.stopped) this.cycle();
    };
    rec.start(1000);
    this.timer = window.setTimeout(
      () => {
        if (rec.state === "recording") rec.stop();
      },
      Math.max(5, this.opts.clipLen) * 1000,
    );
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index] ?? 0;
}

/**
 * Pontuação determinística usada pelo monitor. Além de energia, considera fala
 * útil, relação sinal/ruído, cadência e se o trecho começa e termina limpo.
 */
export function analyzeLiveRms(rms: number[], duration: number, hop = 0.1): LiveClipAnalysis {
  const safeDuration = Math.max(hop, duration || rms.length * hop);
  if (!rms.length) {
    return {
      score: 45,
      trim: { start: 0, end: safeDuration },
      reason: "áudio indisponível; revise o corte antes de publicar",
      tags: ["revisão manual"],
      metrics: { speech: 0, clarity: 0, hook: 0, cadence: 0 },
    };
  }

  const floor = percentile(rms, 0.2);
  const loud = Math.max(floor + 1e-6, percentile(rms, 0.9));
  const peak = Math.max(loud, percentile(rms, 0.98));
  const threshold = floor + (loud - floor) * 0.2;
  const active = rms.map((value) => value > threshold);

  // Une pausas curtas para não tratar cada palavra como um novo trecho.
  const bridgeFrames = Math.max(1, Math.round(0.35 / hop));
  for (let i = 0; i < active.length; i++) {
    if (active[i]) continue;
    let end = i;
    while (end < active.length && !active[end]) end++;
    if (i > 0 && end < active.length && end - i <= bridgeFrames) {
      for (let j = i; j < end; j++) active[j] = true;
    }
    i = end - 1;
  }

  const first = active.findIndex(Boolean);
  let last = -1;
  for (let i = active.length - 1; i >= 0; i--) {
    if (active[i]) {
      last = i;
      break;
    }
  }

  const speech = active.filter(Boolean).length / active.length;
  const clarity = clamp01((loud - floor) / Math.max(0.015, loud));
  const dynamics = clamp01((peak - floor) / Math.max(0.02, peak));
  const openingFrames = Math.max(1, Math.round(Math.min(3, safeDuration) / hop));
  const openingSpeech = active.slice(0, openingFrames).filter(Boolean).length / openingFrames;
  const hookEnergy = clamp01(percentile(rms.slice(0, openingFrames), 0.85) / loud);
  const hook = clamp01(openingSpeech * 0.55 + hookEnergy * 0.45);

  let transitions = 0;
  for (let i = 1; i < active.length; i++) {
    if (active[i] !== active[i - 1]) transitions++;
  }
  const transitionsPerMinute = transitions / Math.max(1 / 60, safeDuration / 60);
  const cadence = clamp01(1 - Math.abs(transitionsPerMinute - 10) / 18);
  const speechFit = clamp01(1 - Math.abs(speech - 0.68) / 0.68);

  const leadSilence = first < 0 ? safeDuration : first * hop;
  const tailSilence = last < 0 ? safeDuration : Math.max(0, safeDuration - (last + 1) * hop);
  const edgeQuality = clamp01(
    1 - (Math.max(0, leadSilence - 1.5) + Math.max(0, tailSilence - 1.8)) / 8,
  );
  const clippingPenalty = percentile(rms, 0.995) > 0.72 ? 8 : 0;

  const quality =
    speechFit * 0.22 +
    clarity * 0.12 +
    hook * 0.28 + // Mais peso no gancho para lives
    cadence * 0.15 +
    dynamics * 0.1 +
    edgeQuality * 0.13;
  const score = Math.round(Math.max(12, Math.min(99, 15 + quality * 84 - clippingPenalty)));

  const trimStart = first >= 0 ? Math.max(0, first * hop - 0.35) : 0;
  const trimEnd = last >= 0 ? Math.min(safeDuration, (last + 1) * hop + 0.55) : safeDuration;
  const trim =
    trimEnd - trimStart >= 3
      ? { start: Number(trimStart.toFixed(2)), end: Number(trimEnd.toFixed(2)) }
      : { start: 0, end: Number(safeDuration.toFixed(2)) };

  const tags: string[] = [];
  if (hook >= 0.62) tags.push("gancho forte");
  if (clarity >= 0.62) tags.push("fala clara");
  if (cadence >= 0.58) tags.push("bom ritmo");
  if (edgeQuality >= 0.7) tags.push("corte limpo");
  if (speech < 0.28) tags.push("pouca fala");

  const reasons: string[] = [];
  if (hook >= 0.65) reasons.push("gancho de abertura forte");
  if (clarity >= 0.65) reasons.push("diálogo limpo e inteligível");
  if (cadence >= 0.6) reasons.push("bom ritmo narrativo");
  if (speechFit >= 0.7) reasons.push("excelente densidade de fala");
  if (!reasons.length) reasons.push("trecho capturado automaticamente");

  return {
    score,
    trim,
    reason: reasons.join(" · "),
    tags,
    metrics: { speech, clarity, hook, cadence },
  };
}

/** Analisa o áudio do corte gravado e sugere limites sem silêncio nas pontas. */
export async function analyzeLiveClip(blob: Blob, duration?: number): Promise<LiveClipAnalysis> {
  try {
    const buf = await blob.arrayBuffer();
    const Ctx =
      typeof window !== "undefined" ? (window.AudioContext ?? (window as any).webkitAudioContext) : (global as any).AudioContext;
    if (!Ctx) throw new Error("AudioContext not supported");
    const ac = new Ctx();
    const audio = await ac.decodeAudioData(buf);
    void ac.close();
    const ch = audio.getChannelData(0);
    const sampleWindow = Math.max(1, Math.floor(audio.sampleRate * 0.1));
    const rms: number[] = [];
    for (let i = 0; i + sampleWindow <= ch.length; i += sampleWindow) {
      let sum = 0;
      for (let j = i; j < i + sampleWindow; j++) sum += ch[j]! * ch[j]!;
      rms.push(Math.sqrt(sum / sampleWindow));
    }
    return analyzeLiveRms(rms, duration ?? audio.duration, 0.1);
  } catch {
    return analyzeLiveRms([], duration ?? 0);
  }
}

/** Compatibilidade com chamadas antigas que precisam apenas do score. */
export async function scoreClip(blob: Blob): Promise<number> {
  return (await analyzeLiveClip(blob)).score;
}

/** Rótulo automático do corte a partir do momento em que aconteceu. */
export function clipTitle(at: number, index: number) {
  const m = Math.floor(at / 60);
  const s = Math.floor(at % 60);
  return `Corte ${String(index + 1).padStart(2, "0")} · ${m}m${String(s).padStart(2, "0")}`;
}

export interface TrimOptions {
  start: number;
  end: number;
  /** reenquadra para 9:16 (vertical) */
  vertical: boolean;
  onProgress?: (p: number) => void;
}

/**
 * Exporta o corte editado (trim + enquadramento vertical) re-gravando o trecho
 * num canvas — funciona em qualquer navegador com MediaRecorder.
 */
export async function exportClip(blob: Blob, opts: TrimOptions): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = url;
  video.muted = false;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("não consegui abrir o corte"));
    });

    const srcW = video.videoWidth || 1280;
    const srcH = video.videoHeight || 720;
    const outW = opts.vertical ? 1080 : Math.min(1920, srcW);
    const outH = opts.vertical ? 1920 : Math.round((outW * srcH) / srcW);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;

    const stream = canvas.captureStream(30);
    // leva o áudio original junto
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    const source = ac.createMediaElementSource(video);
    const dest = ac.createMediaStreamDestination();
    source.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

    const mime = pickRecorderMime();
    const rec = new MediaRecorder(
      stream,
      mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined,
    );
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };

    const start = Math.max(0, opts.start);
    const end = Math.max(start + 0.5, opts.end);
    video.currentTime = start;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      window.setTimeout(resolve, 1500);
    });

    rec.start(500);
    await video.play();

    const scale = opts.vertical
      ? Math.max(outW / srcW, outH / srcH)
      : Math.min(outW / srcW, outH / srcH);
    const dw = srcW * scale;
    const dh = srcH * scale;
    const dx = (outW - dw) / 2;
    const dy = (outH - dh) / 2;

    await new Promise<void>((resolve) => {
      const draw = () => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(video, dx, dy, dw, dh);
        opts.onProgress?.(Math.min(1, (video.currentTime - start) / (end - start)));
        if (video.currentTime >= end || video.ended) {
          resolve();
          return;
        }
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
    });

    video.pause();
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    void ac.close();

    return new Blob(chunks, { type: mime || "video/webm" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
