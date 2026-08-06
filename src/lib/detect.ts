import { makeCleanupRegion, type CleanupRegion } from "@/lib/template";

/**
 * Detecção automática de legenda queimada / marca d'água / logo / texto fixo.
 *
 * Três sinais combinados por pixel (em baixa resolução):
 *  1. frequência de borda  → texto, mesmo que o conteúdo mude entre os quadros
 *  2. estabilidade temporal (variância baixa) → marca d'água fixa, mesmo transparente
 *  3. blob de cor constante → logo/imagem sem borda de texto
 *
 * As células fortes são agrupadas em retângulos e classificadas.
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
const EDGE_THR = 0.14;
const VAR_THR = 0.0016;

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
    const n = Math.max(8, Math.min(24, opts.frames ?? (span > 25 ? 20 : 14)));

    const w = SAMPLE_W;
    const h = Math.max(2, Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * SAMPLE_W));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas indisponível");

    const px = w * h;
    const sum = new Float32Array(px);
    const sumSq = new Float32Array(px);
    const edgeHits = new Float32Array(px); // quantos quadros a borda apareceu
    const edgeSum = new Float32Array(px);
    const satSum = new Float32Array(px);
    const satSq = new Float32Array(px);
    let used = 0;

    for (let k = 0; k < n; k++) {
      if (opts.signal?.aborted) throw new Error("cancelado");
      const t = start + (span * (k + 0.5)) / n;
      await seek(v, Math.min(t, Math.max(0, end - 0.05)));
      ctx.drawImage(v, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h).data;

      const g = new Float32Array(px);
      for (let i = 0, p = 0; i < img.length; i += 4, p++) {
        g[p] = gray(img, i);
        const r = img[i]! / 255,
          gg = img[i + 1]! / 255,
          b = img[i + 2]! / 255;
        const mx = Math.max(r, gg, b),
          mn = Math.min(r, gg, b);
        const s = mx <= 0 ? 0 : (mx - mn) / mx;
        satSum[p]! += s;
        satSq[p]! += s * s;
        sum[p]! += g[p]!;
        sumSq[p]! += g[p]! * g[p]!;
      }

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          const e = Math.abs(g[p + 1]! - g[p - 1]!) + Math.abs(g[p + w]! - g[p - w]!);
          edgeSum[p]! += e;
          if (e > EDGE_THR) edgeHits[p]! += 1;
        }
      }

      used++;
      opts.onProgress?.(k + 1, n);
    }

    if (!used) return [];

    // mapas por pixel
    const varG = new Float32Array(px);
    const satVar = new Float32Array(px);
    for (let p = 0; p < px; p++) {
      const m = sum[p]! / used;
      varG[p] = Math.max(0, sumSq[p]! / used - m * m);
      const sm = satSum[p]! / used;
      satVar[p] = Math.max(0, satSq[p]! / used - sm * sm);
    }

    // agregação por célula
    const cellsN = COLS * ROWS;
    const textScore = new Float32Array(cellsN);
    const staticScore = new Float32Array(cellsN);
    const logoScore = new Float32Array(cellsN);
    const count = new Float32Array(cellsN);

    for (let y = 1; y < h - 1; y++) {
      const cy = Math.min(ROWS - 1, Math.floor((y / h) * ROWS));
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const cx = Math.min(COLS - 1, Math.floor((x / w) * COLS));
        const ci = cy * COLS + cx;
        count[ci]! += 1;

        const freq = edgeHits[p]! / used; // 0..1 — texto presente em parte dos quadros
        const strong = Math.min(1, edgeSum[p]! / used / 0.5);
        const stable = varG[p]! < VAR_THR ? 1 : Math.max(0, 1 - varG[p]! / (VAR_THR * 6));

        // texto/legenda: bordas frequentes no mesmo lugar (intermitente também conta)
        textScore[ci]! += Math.min(1, freq * 1.6) * (0.45 + 0.55 * strong);
        // marca d'água: borda existe E o pixel quase não muda no tempo
        staticScore[ci]! += strong * stable;
        // logo/imagem: cor constante ao longo do vídeo, sem exigir texto
        logoScore[ci]! += satVar[p]! < 0.004 && varG[p]! < VAR_THR ? 0.6 : 0;
      }
    }

    const score = new Float32Array(cellsN);
    for (let i = 0; i < cellsN; i++) {
      const cN = Math.max(1, count[i]!);
      const t = textScore[i]! / cN;
      const s = staticScore[i]! / cN;
      const l = logoScore[i]! / cN;
      score[i] = Math.max(t, s * 1.15, Math.min(t + 0.15, l * 0.9));
    }

    const arr = Array.from(score);
    const maxS = Math.max(...arr, 1e-6);
    const sorted = [...arr].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const norm = arr.map((s) => s / maxS);
    const thr = Math.min(0.72, Math.max(0.3, (median / maxS) * 1.75 + 0.12));
    const hot = norm.map((s) => s >= thr);

    // agrupa células vizinhas (flood fill 8-direções) em retângulos
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
        cnt = 0,
        acc = 0;
      while (queue.length) {
        const cur = queue.pop()!;
        const cx = cur % COLS;
        const cy = Math.floor(cur / COLS);
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx);
        y1 = Math.max(y1, cy);
        cnt++;
        acc += norm[cur]!;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx,
              ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
            const j = ny * COLS + nx;
            if (hot[j] && !seen[j]) {
              seen[j] = 1;
              queue.push(j);
            }
          }
        }
      }
      if (cnt >= 2) rects.push({ x0, y0, x1, y1, cells: cnt, s: acc / cnt });
    }

    // converte para regiões normalizadas, com folga e filtros de tamanho
    const padX = 0.8 / COLS;
    const padY = 0.7 / ROWS;
    let out = rects
      .map((r) => {
        const x = Math.max(0, r.x0 / COLS - padX);
        const y = Math.max(0, r.y0 / ROWS - padY);
        const rw = Math.min(1 - x, (r.x1 + 1) / COLS - x + padX);
        const rh = Math.min(1 - y, (r.y1 + 1) / ROWS - y + padY);
        return { x, y, w: rw, h: rh, s: r.s, area: rw * rh };
      })
      .filter((r) => r.area > 0.003 && r.area < 0.5 && r.h < 0.55)
      .sort((a, b) => b.s * Math.sqrt(b.area) - a.s * Math.sqrt(a.area))
      .slice(0, 8);

    // remove retângulos muito sobrepostos (fica o de maior score)
    const keep: typeof out = [];
    for (const r of out) {
      const overlaps = keep.some((k) => {
        const ix = Math.max(0, Math.min(r.x + r.w, k.x + k.w) - Math.max(r.x, k.x));
        const iy = Math.max(0, Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y));
        const inter = ix * iy;
        return inter > 0.45 * Math.min(r.area, k.area);
      });
      if (!overlaps) keep.push(r);
    }
    out = keep.slice(0, 5);

    return out.map((r) => {
      const middle = r.y + r.h / 2;
      const wide = r.w > 0.4;
      const small = r.area < 0.07;
      const corner = (r.x < 0.12 || r.x + r.w > 0.88) && (r.y < 0.18 || r.y + r.h > 0.82);
      const isCaption = wide && middle > 0.55;
      const isWatermark = small && corner;
      const isLogo = small && !corner && middle < 0.35;
      const label = isCaption
        ? "Legenda queimada"
        : isWatermark
          ? "Marca d'água"
          : isLogo
            ? "Logo / imagem"
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
          mode: "inpaint",
          strength: isCaption ? 55 : 65,
          from: middle > 0.5 ? "bottom" : "top",
        }),
      };
    });
  } finally {
    v.src = "";
    if (typeof file !== "string") URL.revokeObjectURL(url);
  }
}
