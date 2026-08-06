import { type CleanupRegion } from "@/lib/template";
import { detectFromFrames, groupCells, mergeRanges } from "@/lib/detect-core";

export { groupCells, mergeRanges };

/**
 * Detecção automática de legenda queimada / marca d'água / logo / texto fixo.
 * Aqui fica só a amostragem de quadros do vídeo; a análise vive em detect-core
 * (função pura, coberta pela suíte de fixtures).
 */

export type DetectOpts = {
  clip?: { start: number; end: number } | undefined;
  /** quantos quadros amostrar */
  frames?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

const SAMPLE_W = 384;

function gray(data: Uint8ClampedArray, i: number) {
  return (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) / 255;
}

async function seek(v: HTMLVideoElement, t: number) {
  await new Promise<void>((resolve) => {
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      v.removeEventListener("seeked", fin);
      resolve();
    };
    v.addEventListener("seeked", fin);
    v.currentTime = t;
    setTimeout(fin, 1500);
  });
}

/** zonas típicas usadas como rede de segurança quando nada é detectado */
export function safeZones(): Partial<CleanupRegion>[] {
  return [
    { label: "Rodapé de legenda (sugestão)", x: 0.06, y: 0.72, w: 0.88, h: 0.16, mode: "inpaint", strength: 50 },
    { label: "Marca d'água canto (sugestão)", x: 0.66, y: 0.03, w: 0.31, h: 0.1, mode: "inpaint", strength: 60 },
  ];
}

export async function detectOverlays(
  file: File | string,
  opts: DetectOpts = {},
): Promise<Partial<CleanupRegion>[]> {
  const url = typeof file === "string" ? file : URL.createObjectURL(file);
  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  v.crossOrigin = "anonymous";
  v.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("não consegui decodificar este vídeo no navegador"));
      setTimeout(() => reject(new Error("tempo esgotado ao abrir o vídeo")), 20000);
    });

    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    const start = Math.max(0, opts.clip?.start ?? 0);
    const end = Math.min(dur || 1e9, opts.clip?.end ?? (dur || 1));
    const span = Math.max(0.2, end - start);
    const n = Math.max(8, Math.min(18, opts.frames ?? (span > 25 ? 16 : 12)));

    const w = SAMPLE_W;
    const h = Math.max(2, Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * SAMPLE_W));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas indisponível");

    const px = w * h;
    const frames: Float32Array[] = [];
    const stamps: number[] = [];

    for (let k = 0; k < n; k++) {
      if (opts.signal?.aborted) throw new Error("cancelado");
      const t = start + (span * (k + 0.5)) / n;
      await seek(v, Math.min(t, Math.max(0, end - 0.05)));
      ctx.drawImage(v, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h).data;

      const g = new Float32Array(px);
      for (let i = 0, p = 0; i < img.length; i += 4, p++) g[p] = gray(img, i);

      frames.push(g);
      stamps.push(t);
      opts.onProgress?.(k + 1, n);
    }

    return detectFromFrames({ frames, w, h, stamps, span });
  } finally {
    v.src = "";
    if (typeof file !== "string") URL.revokeObjectURL(url);
  }
}
