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
  /** recorte escolhido pelo usuário no editor */
  trim?: { start: number; end: number };
}

export function hlsProxyUrl(url: string) {
  return `/api/public/hls-proxy?u=${encodeURIComponent(url)}`;
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
  const src = hlsProxyUrl(playlist);
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
      rec = new MediaRecorder(this.stream, mime ? { mimeType: mime, videoBitsPerSecond: 4_000_000 } : undefined);
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
    this.timer = window.setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, Math.max(5, this.opts.clipLen) * 1000);
  }
}

/** Pontua o corte por energia de fala, dinâmica e picos (0..100). */
export async function scoreClip(blob: Blob): Promise<number> {
  try {
    const buf = await blob.arrayBuffer();
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    const audio = await ac.decodeAudioData(buf);
    void ac.close();
    const ch = audio.getChannelData(0);
    const hop = Math.max(1, Math.floor(audio.sampleRate * 0.1));
    const rms: number[] = [];
    for (let i = 0; i + hop <= ch.length; i += hop) {
      let s = 0;
      for (let j = i; j < i + hop; j++) s += ch[j]! * ch[j]!;
      rms.push(Math.sqrt(s / hop));
    }
    if (!rms.length) return 45;
    const mean = rms.reduce((a, b) => a + b, 0) / rms.length;
    const peak = Math.max(...rms);
    const sorted = [...rms].sort((a, b) => a - b);
    const noise = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
    const speech = rms.filter((v) => v > noise * 2.2).length / rms.length;
    const dyn = peak > 0 ? (peak - mean) / peak : 0;

    const score = 35 + speech * 35 + Math.min(1, mean * 12) * 18 + dyn * 12;
    return Math.round(Math.max(5, Math.min(99, score)));
  } catch {
    return 50;
  }
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
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    const source = ac.createMediaElementSource(video);
    const dest = ac.createMediaStreamDestination();
    source.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

    const mime = pickRecorderMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
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
