import { CANVAS_H, CANVAS_W, type Template } from "./template";
import { drawFrame } from "./draw";
import { encodeMp4, webCodecsSupported } from "./encode";
import type { Variation } from "./variation";

export interface RenderOptions {
  variation: Variation;
  offsetX: number;
  offsetY: number;
  headline?: string | undefined;
  fps?: number | undefined;
  bitrate?: number | undefined;
  turbo?: number | undefined;
  clip?: { start: number; end: number } | undefined;
  onProgress?: ((p: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

function pickMime() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

/** Fallback em tempo real (navegadores sem WebCodecs). */
async function recordVideo(
  file: File,
  template: Template,
  opts: RenderOptions,
): Promise<{ blob: Blob; ext: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  const v = opts.variation;
  video.src = url;
  video.playsInline = true;
  video.playbackRate = v.speed;

  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("Não foi possível ler o vídeo"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = template.canvasW ?? CANVAS_W;
  canvas.height = template.canvasH ?? CANVAS_H;
  const ctx = canvas.getContext("2d")!;

  const fps = opts.fps ?? 30;
  const stream = canvas.captureStream(fps);
  try {
    const media = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    media?.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch {
    /* sem áudio */
  }

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: opts.bitrate ?? 10_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const tpl: Template = opts.headline
    ? { ...template, headline: { ...template.headline, text: opts.headline } }
    : template;

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  const clipStart = Math.max(0, Math.min(opts.clip?.start ?? 0, Math.max(0, video.duration - 0.5)));
  const clipEnd = Math.min(video.duration, opts.clip?.end ?? video.duration);
  const endAt = Math.max(clipStart + 0.2, clipEnd - v.trimEnd);
  let raf = 0;
  const loop = () => {
    drawFrame(ctx, tpl, { el: video, width: video.videoWidth, height: video.videoHeight }, {
      mirror: v.mirror,
      offsetX: opts.offsetX,
      offsetY: opts.offsetY,
      brightness: v.brightness,
      saturation: v.saturation,
      zoom: v.zoom,
      noise: v.noise,
    });
    if (video.duration) opts.onProgress?.(Math.min(1, video.currentTime / endAt));
    if (video.currentTime >= endAt) video.pause();
    raf = requestAnimationFrame(loop);
  };

  video.currentTime = clipStart + v.trimStart;
  recorder.start(1000);
  await video.play();
  loop();

  await new Promise<void>((res) => {
    const check = setInterval(() => {
      if (video.ended || video.paused || video.currentTime >= endAt) {
        clearInterval(check);
        res();
      }
    }, 120);
  });

  cancelAnimationFrame(raf);
  recorder.stop();
  const blob = await done;
  URL.revokeObjectURL(url);
  opts.onProgress?.(1);
  return { blob, ext: mimeType.startsWith("video/mp4") ? "mp4" : "webm" };
}

export async function renderVideo(
  file: File,
  template: Template,
  opts: RenderOptions,
): Promise<{ blob: Blob; ext: string }> {
  if (webCodecsSupported()) {
    try {
      const blob = await encodeMp4({
        file,
        template,
        variation: opts.variation,
        offsetX: opts.offsetX,
        offsetY: opts.offsetY,
        headline: opts.headline,
        fps: opts.fps ?? 30,
        bitrate: opts.bitrate ?? 10_000_000,
        turbo: opts.turbo ?? 4,
        clip: opts.clip,
        onProgress: opts.onProgress,
        signal: opts.signal,
      });
      return { blob, ext: "mp4" };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") throw err;
      console.warn("WebCodecs falhou, usando fallback:", err);
    }
  }
  return recordVideo(file, template, opts);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function grabPoster(
  file: File,
  at = 0.5,
): Promise<{ url: string; w: number; h: number; duration: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("erro"));
  });
  video.currentTime = Math.min(at, Math.max(0, video.duration - 0.1));
  await new Promise<void>((res) => {
    video.onseeked = () => res();
  });
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d")!.drawImage(video, 0, 0);
  const out = {
    url: c.toDataURL("image/jpeg", 0.7),
    w: video.videoWidth,
    h: video.videoHeight,
    duration: video.duration,
  };
  URL.revokeObjectURL(url);
  return out;
}

export { CANVAS_H, CANVAS_W };
