import { makeCleanupRegion, type CleanupRegion } from "@/lib/template";

/**
 * Núcleo puro da detecção de overlays (sem DOM) — recebe quadros já em escala
 * de cinza e devolve as regiões. Permite testar precisão com fixtures sintéticas.
 */

export const COLS = 40;
export const ROWS = 72;
const EDGE_THR = 0.13;
/** |g - mediana| abaixo disso = pixel "parado" naquele quadro */
const STABLE_EPS = 0.035;

export type FrameSet = {
  /** quadros em cinza [0..1], todos com w*h pixels */
  frames: Float32Array[];
  w: number;
  h: number;
  /** instante (s) de cada quadro */
  stamps: number[];
  /** duração total analisada (s) */
  span: number;
};

/** agrupa células “quentes” vizinhas (8-direções) em retângulos — puro, testável */
export function groupCells(
  hot: boolean[],
  score: number[],
  cols: number,
  rows: number,
): { x0: number; y0: number; x1: number; y1: number; cells: number; s: number }[] {
  const seen = new Uint8Array(hot.length);
  const rects: { x0: number; y0: number; x1: number; y1: number; cells: number; s: number }[] = [];
  for (let i = 0; i < hot.length; i++) {
    if (!hot[i] || seen[i]) continue;
    const queue = [i];
    seen[i] = 1;
    let x0 = cols,
      y0 = rows,
      x1 = -1,
      y1 = -1,
      cnt = 0,
      acc = 0;
    while (queue.length) {
      const cur = queue.pop()!;
      const cx = cur % cols;
      const cy = Math.floor(cur / cols);
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
      cnt++;
      acc += score[cur] ?? 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (hot[j] && !seen[j]) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
    }
    if (cnt >= 2) rects.push({ x0, y0, x1, y1, cells: cnt, s: acc / cnt });
  }
  return rects;
}

/** junta instantes em intervalos contínuos com folga — puro, testável */
export function mergeRanges(times: number[], pad: number, gap: number) {
  const out: { start: number; end: number }[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && t - last.end <= gap) last.end = t + pad;
    else out.push({ start: Math.max(0, t - pad), end: t + pad });
  }
  return out;
}

export function detectFromFrames(set: FrameSet): Partial<CleanupRegion>[] {
  const { frames, w, h, stamps, span } = set;
  const used = frames.length;
  if (!used) return [];
  const px = w * h;

  // ---- bordas por quadro ----
  const edgeHits = new Float32Array(px);
  const edgeSum = new Float32Array(px);
  for (let k = 0; k < used; k++) {
    const g = frames[k]!;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const e = Math.abs(g[p + 1]! - g[p - 1]!) + Math.abs(g[p + w]! - g[p - w]!);
        edgeSum[p]! += e;
        if (e > EDGE_THR) edgeHits[p]! += 1;
      }
    }
  }

  // ---- mediana temporal por pixel ----
  const med = new Float32Array(px);
  const buf = new Float64Array(used);
  for (let p = 0; p < px; p++) {
    for (let k = 0; k < used; k++) buf[k] = frames[k]![p]!;
    const s = Array.from(buf).sort((a, b) => a - b);
    med[p] = used % 2 ? s[(used - 1) / 2]! : (s[used / 2 - 1]! + s[used / 2]!) / 2;
  }

  const medEdge = new Float32Array(px);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      medEdge[p] = Math.abs(med[p + 1]! - med[p - 1]!) + Math.abs(med[p + w]! - med[p - w]!);
    }
  }

  const stable = new Float32Array(px);
  const motion = new Float32Array(px);
  for (let p = 0; p < px; p++) {
    let st = 0;
    let mo = 0;
    for (let k = 0; k < used; k++) {
      const d = Math.abs(frames[k]![p]! - med[p]!);
      if (d < STABLE_EPS) st++;
      mo += d;
    }
    stable[p] = st / used;
    motion[p] = mo / used;
  }

  // ---- agregação por célula ----
  const cellsN = COLS * ROWS;
  const textScore = new Float32Array(cellsN);
  const staticScore = new Float32Array(cellsN);
  const cellMotion = new Float32Array(cellsN);
  const count = new Float32Array(cellsN);

  for (let y = 1; y < h - 1; y++) {
    const cy = Math.min(ROWS - 1, Math.floor((y / h) * ROWS));
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const cx = Math.min(COLS - 1, Math.floor((x / w) * COLS));
      const ci = cy * COLS + cx;
      count[ci]! += 1;

      const freq = edgeHits[p]! / used;
      const strong = Math.min(1, edgeSum[p]! / used / 0.5);
      textScore[ci]! += freq >= 0.25 ? Math.min(1, freq * 1.3) * (0.35 + 0.65 * strong) : 0;
      staticScore[ci]! += Math.min(1, medEdge[p]! / 0.45) * stable[p]!;
      cellMotion[ci]! += motion[p]!;
    }
  }

  const motionN = new Float32Array(cellsN);
  for (let i = 0; i < cellsN; i++) {
    const cN = Math.max(1, count[i]!);
    motionN[i] = cellMotion[i]! / cN;
    textScore[i] = textScore[i]! / cN;
    staticScore[i] = staticScore[i]! / cN;
  }

  // movimento médio da vizinhança (anel 5x5) — o fundo atrás de um overlay se mexe
  const ringMotion = new Float32Array(cellsN);
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      let acc = 0;
      let k = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx,
            ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          acc += motionN[ny * COLS + nx]!;
          k++;
        }
      }
      ringMotion[cy * COLS + cx] = k ? acc / k : 0;
    }
  }

  const globalMotion = Array.from(motionN).reduce((a, b) => a + b, 0) / cellsN;
  const score = new Float32Array(cellsN);
  for (let i = 0; i < cellsN; i++) {
    const t = textScore[i]!;
    const contrastMotion = Math.min(
      1,
      Math.max(0, ringMotion[i]! - motionN[i]!) / Math.max(0.01, globalMotion),
    );
    const s = staticScore[i]! * (0.25 + 0.75 * contrastMotion);
    score[i] = Math.max(t, s * 1.2);
  }

  const arr = Array.from(score);
  const maxS = Math.max(...arr, 1e-6);
  const sorted = [...arr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const norm = arr.map((s) => s / maxS);
  const thr = Math.min(0.75, Math.max(0.34, (median / maxS) * 1.8 + 0.16));
  const hot = norm.map((s) => s >= thr);

  const rects = groupCells(hot, norm, COLS, ROWS);

  const pixelScore = (p: number, ci: number) => {
    const freq = edgeHits[p]! / used;
    const strong = Math.min(1, edgeSum[p]! / used / 0.5);
    const t = freq >= 0.25 ? Math.min(1, freq * 1.3) * (0.35 + 0.65 * strong) : 0;
    const s = Math.min(1, medEdge[p]! / 0.45) * stable[p]!;
    return Math.max(
      t,
      s * (0.3 + 0.7 * Math.min(1, ringMotion[ci]! / Math.max(0.01, globalMotion))),
    );
  };

  const padX = 0.8 / COLS;
  const padY = 0.8 / ROWS;
  let out = rects
    .map((r) => {
      // contorno real do overlay dentro da caixa (com folga de duas células)
      const gx0 = Math.max(0, Math.floor(((r.x0 - 2) / COLS) * w));
      const gx1 = Math.min(w, Math.ceil(((r.x1 + 3) / COLS) * w));
      const gy0 = Math.max(0, Math.floor(((r.y0 - 2) / ROWS) * h));
      const gy1 = Math.min(h, Math.ceil(((r.y1 + 3) / ROWS) * h));
      let bx0 = gx1,
        by0 = gy1,
        bx1 = gx0,
        by1 = gy0,
        hits = 0;
      for (let y = Math.max(1, gy0); y < Math.min(h - 1, gy1); y++) {
        const cy = Math.min(ROWS - 1, Math.floor((y / h) * ROWS));
        for (let x = Math.max(1, gx0); x < Math.min(w - 1, gx1); x++) {
          const cx = Math.min(COLS - 1, Math.floor((x / w) * COLS));
          const ps = pixelScore(y * w + x, cy * COLS + cx);
          if (ps / maxS >= thr * 0.6) {
            bx0 = Math.min(bx0, x);
            by0 = Math.min(by0, y);
            bx1 = Math.max(bx1, x);
            by1 = Math.max(by1, y);
            hits++;
          }
        }
      }
      const useRefined = hits > 8 && bx1 > bx0 && by1 > by0;
      const x = useRefined ? Math.max(0, bx0 / w - padX) : Math.max(0, r.x0 / COLS - padX);
      const y = useRefined ? Math.max(0, by0 / h - padY) : Math.max(0, r.y0 / ROWS - padY);
      const rw = Math.min(1 - x, (useRefined ? (bx1 + 1) / w : (r.x1 + 1) / COLS) - x + padX);
      const rh = Math.min(1 - y, (useRefined ? (by1 + 1) / h : (r.y1 + 1) / ROWS) - y + padY);
      const ci =
        Math.min(ROWS - 1, Math.floor((y + rh / 2) * ROWS)) * COLS +
        Math.min(COLS - 1, Math.floor((x + rw / 2) * COLS));
      return { x, y, w: rw, h: rh, s: r.s, area: rw * rh, ci };
    })
    .filter((r) => r.area > 0.0015 && r.area < 0.5 && r.h < 0.55)
    .sort((a, b) => b.s * Math.sqrt(b.area) - a.s * Math.sqrt(a.area))
    .slice(0, 8);

  const keep: typeof out = [];
  for (const r of out) {
    const overlaps = keep.some((k) => {
      const ix = Math.max(0, Math.min(r.x + r.w, k.x + k.w) - Math.max(r.x, k.x));
      const iy = Math.max(0, Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y));
      return ix * iy > 0.4 * Math.min(r.area, k.area);
    });
    if (!overlaps) keep.push(r);
  }
  out = keep.slice(0, 5);

  // ---- persistência + janelas de tempo por região ----
  const step = span / used;
  const regions: Partial<CleanupRegion>[] = [];
  for (const r of out) {
    const x0 = Math.max(1, Math.floor(r.x * w));
    const x1 = Math.min(w - 1, Math.ceil((r.x + r.w) * w));
    const y0 = Math.max(1, Math.floor(r.y * h));
    const y1 = Math.min(h - 1, Math.ceil((r.y + r.h) * h));
    if (x1 <= x0 || y1 <= y0) continue;

    const energy: number[] = [];
    for (let k = 0; k < used; k++) {
      const g = frames[k]!;
      let acc = 0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * w + x;
          acc += Math.abs(g[p + 1]! - g[p - 1]!) + Math.abs(g[p + w]! - g[p - w]!);
          cnt++;
        }
      }
      energy.push(cnt ? acc / cnt : 0);
    }
    const eMax = Math.max(...energy);
    const eMin = Math.min(...energy);
    const cut = eMin + (eMax - eMin) * 0.45;
    const onIdx = energy.map((e, i) => (e >= cut ? i : -1)).filter((i) => i >= 0);
    const persistence = onIdx.length / used;
    if (persistence < 0.3) continue;

    const alwaysOn = persistence > 0.85 || eMax - eMin < 0.05;
    const timeRanges = alwaysOn
      ? undefined
      : mergeRanges(
          onIdx.map((i) => stamps[i] ?? 0),
          step * 0.75,
          step * 1.6,
        );

    const middle = r.y + r.h / 2;
    const wide = r.w > 0.4;
    const small = r.area < 0.07;
    const corner = (r.x < 0.14 || r.x + r.w > 0.86) && (r.y < 0.2 || r.y + r.h > 0.8);
    const isCaption = wide && middle > 0.55 && !alwaysOn;
    const isWatermark = alwaysOn && (small || corner);
    const label = isCaption
      ? "Legenda queimada"
      : isWatermark
        ? "Marca d'água"
        : alwaysOn && middle < 0.35
          ? "Logo / imagem"
          : middle < 0.3
            ? "Texto no topo"
            : wide && middle > 0.55
              ? "Legenda queimada"
              : "Texto sobreposto";

    const moves = ringMotion[r.ci]! > Math.max(0.012, globalMotion * 0.8);

    regions.push(
      makeCleanupRegion({
        label,
        x: Number(r.x.toFixed(4)),
        y: Number(r.y.toFixed(4)),
        w: Number(r.w.toFixed(4)),
        h: Number(r.h.toFixed(4)),
        mode: "inpaint",
        strength: isCaption ? 55 : 65,
        from: middle > 0.5 ? "bottom" : "top",
        recover: moves ? "median" : "inpaint",
        ...(timeRanges?.length ? { timeRanges } : {}),
      }),
    );
  }

  return regions;
}

/* ------------------------------------------------------------------ */
/* Métricas de validação (usadas pela suíte de fixtures)               */
/* ------------------------------------------------------------------ */

export type Box = { x: number; y: number; w: number; h: number };

export function coverage(truth: Box, got: Box) {
  const ix = Math.max(0, Math.min(truth.x + truth.w, got.x + got.w) - Math.max(truth.x, got.x));
  const iy = Math.max(0, Math.min(truth.y + truth.h, got.y + got.h) - Math.max(truth.y, got.y));
  const inter = ix * iy;
  const tArea = Math.max(1e-9, truth.w * truth.h);
  return inter / tArea;
}

/** melhor cobertura de uma verdade entre todas as regiões detectadas */
export function bestCoverage(truth: Box, got: Box[]) {
  return got.reduce((best, g) => Math.max(best, coverage(truth, g)), 0);
}

/** regiões que não tocam nenhuma verdade = falsos positivos */
export function falsePositives(truths: Box[], got: Box[]) {
  return got.filter((g) => !truths.some((t) => coverage(t, g) > 0.05)).length;
}
