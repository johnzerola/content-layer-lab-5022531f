import { makeCleanupRegion, type CleanupRegion } from "@/lib/template";

/**
 * Detecção automática de legenda queimada / marca d'água / texto fixo.
 *
 * Ideia: elementos sobrepostos ficam parados no mesmo lugar durante todo o vídeo
 * e têm muita borda (texto/logo). Amostramos alguns quadros, medimos por célula
 * quanta borda existe (texto) e quão pouco a célula muda no tempo (fixo) e
 * juntamos as células fortes em retângulos.
 */

export type DetectOpts = {
  clip?: { start: number; end: number } | undefined;
  /** quantos quadros amostrar */
  frames?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

const COLS = 24;
const ROWS = 40;
const SAMPLE_W = 192;

type Cell = { edge: number; motion: number; bright: number };

function gray(data: Uint8ClampedArray, i: number) {
  return (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) / 255;
}

async function seek(v: HTMLVideoElement, t: number) {
  await new Promise<void>((resolve) => {
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    v.currentTime = t;
    // segurança: alguns formatos não disparam seeked
    setTimeout(done, 1200);
  });
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
      setTimeout(() => reject(new Error("tempo esgotado ao abrir o vídeo")), 15000);
    });

    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    const start = Math.max(0, opts.clip?.start ?? 0);
    const end = Math.min(dur || 1e9, opts.clip?.end ?? dur || 1);
    const span = Math.max(0.2, end - start);
    const n = Math.max(4, Math.min(12, opts.frames ?? 8));

    const w = SAMPLE_W;
    const h = Math.max(2, Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * SAMPLE_W));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas indisponível");

    const cells: Cell[] = Array.from({ length: COLS * ROWS }, () => ({ edge: 0, motion: 0, bright: 0 }));
    let prev: Float32Array | null = null;
    let used = 0;

    for (let k = 0; k < n; k++) {
      if (opts.signal?.aborted) throw new Error("cancelado");
      const t = start + (span * (k + 0.5)) / n;
      await seek(v, Math.min(t, Math.max(0, end - 0.05)));
      ctx.drawImage(v, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h).data;

      const g = new Float32Array(w * h);
      for (let i = 0, p = 0; i < img.length; i += 4, p++) g[p] = gray(img, i);

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          const dx = Math.abs(g[p + 1]! - g[p - 1]!);
          const dy = Math.abs(g[p + w]! - g[p - w]!);
          const edge = dx + dy;
          const motion = prev ? Math.abs(g[p]! - prev[p]!) : 0;
          const ci = Math.min(ROWS - 1, Math.floor((y / h) * ROWS)) * COLS +
            Math.min(COLS - 1, Math.floor((x / w) * COLS));
          const cell = cells[ci]!;
          cell.edge += edge;
          cell.motion += motion;
          cell.bright += g[p]!;
        }
      }
      prev = g;
      used++;
      opts.onProgress?.(k + 1, n);
    }

    if (!used) return [];
    const per = (w * h) / (COLS * ROWS) / used;
    const edges = cells.map((c2) => c2.edge / per);
    const motions = cells.map((c2) => c2.motion / per);

    const maxEdge = Math.max(...edges, 1e-6);
    const sorted = [...edges].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const maxMotion = Math.max(...motions, 1e-6);

    // célula candidata: muita borda comparada ao resto e pouco movimento
    const score = cells.map((_, i) => {
      const e = edges[i]! / maxEdge;
      const m = motions[i]! / maxMotion;
      return e * (1 - Math.min(1, m * 1.6));
    });
    const thr = Math.max(0.28, (median / maxEdge) * 1.9);
    const hot = score.map((s) => s >= thr);

    // agrupa células vizinhas (flood fill 4-direções) em retângulos
    const seen = new Uint8Array(hot.length);
    const rects: { x0: number; y0: number; x1: number; y1: number; cells: number; s: number }[] = [];
    for (let i = 0; i < hot.length; i++) {
      if (!hot[i] || seen[i]) continue;
      const queue = [i];
      seen[i] = 1;
      let x0 = COLS,
        y0 = ROWS,
        x1 = -1,
        y1 = -1,
        count = 0,
        sum = 0;
      while (queue.length) {
        const cur = queue.pop()!;
        const cx = cur % COLS;
        const cy = Math.floor(cur / COLS);
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx);
        y1 = Math.max(y1, cy);
        count++;
        sum += score[cur]!;
        const nb = [
          cx > 0 ? cur - 1 : -1,
          cx < COLS - 1 ? cur + 1 : -1,
          cy > 0 ? cur - COLS : -1,
          cy < ROWS - 1 ? cur + COLS : -1,
        ];
        for (const j of nb) {
          if (j >= 0 && hot[j] && !seen[j]) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
      if (count >= 2) rects.push({ x0, y0, x1, y1, cells: count, s: sum / count });
    }

    // converte para regiões normalizadas, com folga e filtros de tamanho
    const padX = 0.6 / COLS;
    const padY = 0.5 / ROWS;
    const out = rects
      .map((r) => {
        const x = Math.max(0, r.x0 / COLS - padX);
        const y = Math.max(0, r.y0 / ROWS - padY);
        const rw = Math.min(1 - x, (r.x1 + 1) / COLS - x + padX);
        const rh = Math.min(1 - y, (r.y1 + 1) / ROWS - y + padY);
        return { x, y, w: rw, h: rh, s: r.s, area: rw * rh };
      })
      .filter((r) => r.area > 0.004 && r.area < 0.45 && r.h < 0.5)
      .sort((a, b) => b.s * b.area - a.s * a.area)
      .slice(0, 4);

    return out.map((r) => {
      const middle = r.y + r.h / 2;
      const wide = r.w > 0.45;
      const isCaption = wide && middle > 0.55;
      const isWatermark = !wide && r.area < 0.08;
      const label = isCaption
        ? "Legenda queimada"
        : isWatermark
          ? "Marca d'água"
          : middle < 0.3
            ? "Texto no topo"
            : "Texto sobreposto";
      return {
        ...makeCleanupRegion({
          label,
          x: Number(r.x.toFixed(4)),
          y: Number(r.y.toFixed(4)),
          w: Number(r.w.toFixed(4)),
          h: Number(r.h.toFixed(4)),
          mode: isWatermark ? "blur" : "smear",
          strength: isWatermark ? 60 : 45,
          from: middle > 0.5 ? "bottom" : "top",
        }),
      };
    });
  } finally {
    v.src = "";
    if (typeof file !== "string") URL.revokeObjectURL(url);
  }
}
