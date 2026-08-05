import { CANVAS_H, CANVAS_W, type Template } from "./template";
import { drawFrame } from "./draw";

export interface RenderOptions {
  mirror: boolean;
  speed: number;
  offsetX: number;
  offsetY: number;
  headline?: string;
  onProgress?: (p: number) => void;
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

export async function renderVideo(
  file: File,
  template: Template,
  opts: RenderOptions,
): Promise<{ blob: Blob; ext: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = false;
  video.playsInline = true;
  video.playbackRate = opts.speed;

  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error("Não foi possível ler o vídeo"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;

  const stream = canvas.captureStream(30);
  try {
    const media = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    media?.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch {
    /* sem áudio */
  }

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const tpl: Template = opts.headline
    ? { ...template, headline: { ...template.headline, text: opts.headline } }
    : template;

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  let raf = 0;
  const loop = () => {
    drawFrame(ctx, tpl, { el: video, width: video.videoWidth, height: video.videoHeight }, {
      mirror: opts.mirror,
      offsetX: opts.offsetX,
      offsetY: opts.offsetY,
    });
    if (video.duration) opts.onProgress?.(Math.min(1, video.currentTime / video.duration));
    raf = requestAnimationFrame(loop);
  };

  recorder.start(1000);
  await video.play();
  loop();

  await new Promise<void>((res) => {
    video.onended = () => res();
  });

  cancelAnimationFrame(raf);
  recorder.stop();
  const blob = await done;
  URL.revokeObjectURL(url);
  opts.onProgress?.(1);
  return { blob, ext: mimeType.startsWith("video/mp4") ? "mp4" : "webm" };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function grabPoster(file: File, at = 0.5): Promise<{ url: string; w: number; h: number; duration: number }> {
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
