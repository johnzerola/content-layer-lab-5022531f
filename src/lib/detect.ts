import { makeCleanupRegion, type CleanupRegion } from "@/lib/template";

/**
 * Detecção automática de legenda queimada / marca d'água / logo / texto fixo.
 *
 * Baseada em MEDIANA TEMPORAL (o que sites como Vmake fazem antes de reconstruir):
 *  - a mediana por pixel remove o conteúdo que muda e preserva o que fica parado;
 *  - um overlay estático (logo, @usuário, marca d'água transparente) aparece nítido
 *    na mediana e quase não varia no tempo → estabilidade alta + borda nítida;
 *  - legenda queimada é intermitente → bordas fortes que voltam sempre na mesma faixa.
 *
 * Os candidatos passam por um filtro de persistência (o sinal precisa se repetir na
 * maioria dos quadros) e a caixa final é ajustada ao contorno real do overlay.
 */

export type DetectOpts = {
  clip?: { start: number; end: number } | undefined;
  /** quantos quadros amostrar */
  frames?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

const COLS = 32;
const ROWS = 56;
const SAMPLE_W = 320;
const EDGE_THR = 0.13;
/** |g - mediana| abaixo disso = pixel “parado” naquele quadro */
const STABLE_EPS = 0.035;

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
    const edgeHits = new Float32Array(px);
    const edgeSum = new Float32Array(px);

    for (let k = 0; k < n; k++) {
      if (opts.signal?.aborted) throw new Error("cancelado");
      const t = start + (span * (k + 0.5)) / n;
      await seek(v, Math.min(t, Math.max(0, end - 0.05)));
      ctx.drawImage(v, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h).data;

      const g = new Float32Array(px);
      for (let i = 0, p = 0; i < img.length; i += 4, p++) g[p] = gray(img, i);

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          const e = Math.abs(g[p + 1]! - g[p - 1]!) + Math.abs(g[p + w]! - g[p - w]!);
          edgeSum[p]! += e;
          if (e > EDGE_THR) edgeHits[p]! += 1;
        }
      }

      frames.push(g);
      stamps.push(t);
      opts.onProgress?.(k + 1, n);
    }

    const used = frames.length;
    if (!used) return [];

    // ---- mediana temporal por pixel ----
    const med = new Float32Array(px);
    const buf = new Float32Array(used);
    for (let p = 0; p < px; p++) {
      for (let k = 0; k < used; k++) buf[k] = frames[k]![p]!;
      const s = Array.prototype.slice.call(buf).sort((a: number, b: number) => a - b) as number[];
      med[p] = used % 2 ? s[(used - 1) / 2]! : (s[used / 2 - 1]! + s[used / 2]!) / 2;
    }

    // borda da imagem mediana (overlay estático fica nítido aqui)
    const medEdge = new Float32Array(px);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        medEdge[p] = Math.abs(med[p + 1]! - med[p - 1]!) + Math.abs(med[p + w]! - med[p - w]!);
      }
    }

    // estabilidade e movimento por pixel
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
    const cellStable = new Float32Array(cellsN);
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
        // legenda: bordas fortes que reaparecem no mesmo lugar (intermitentes)
        textScore[ci]! += freq >= 0.25 ? Math.min(1, freq * 1.3) * (0.35 + 0.65 * strong) : 0;
        // overlay estático: nítido na mediana E parado no tempo
        staticScore[ci]! += Math.min(1, medEdge[p]! / 0.45) * stable[p]!;
        cellMotion[ci]! += motion[p]!;
        cellStable[ci]! += stable[p]!;
      }
    }

    const motionN = new Float32Array(cellsN);
    for (let i = 0; i < cellsN; i++) {
      const cN = Math.max(1, count[i]!);
      motionN[i] = cellMotion[i]! / cN;
      textScore[i] = textScore[i]! / cN;
      staticScore[i] = staticScore[i]! / cN;
      cellStable[i] = cellStable[i]! / cN;
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
      // overlay estático só conta se o entorno se mexe (cena parada = tudo estável)
      const contrastMotion = Math.min(1, Math.max(0, ringMotion[i]! - motionN[i]!) / Math.max(0.01, globalMotion));
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

    // ---- caixa refinada no nível do pixel ----
    const pixelScore = (p: number, ci: number) => {
      const freq = edgeHits[p]! / used;
      const strong = Math.min(1, edgeSum[p]! / used / 0.5);
      const t = freq >= 0.25 ? Math.min(1, freq * 1.3) * (0.35 + 0.65 * strong) : 0;
      const s = Math.min(1, medEdge[p]! / 0.45) * stable[p]!;
      return Math.max(t, s * (0.3 + 0.7 * Math.min(1, ringMotion[ci]! / Math.max(0.01, globalMotion))));
    };

    const padX = 1.0 / COLS;
    const padY = 0.9 / ROWS;
    let out = rects
      .map((r) => {
        // varre os pixels da caixa (com folga de uma célula) e acha o contorno real
        const gx0 = Math.max(0, Math.floor(((r.x0 - 1) / COLS) * w));
        const gx1 = Math.min(w, Math.ceil(((r.x1 + 2) / COLS) * w));
        const gy0 = Math.max(0, Math.floor(((r.y0 - 1) / ROWS) * h));
        const gy1 = Math.min(h, Math.ceil(((r.y1 + 2) / ROWS) * h));
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
            if (ps / maxS >= thr * 0.75) {
              bx0 = Math.min(bx0, x);
              by0 = Math.min(by0, y);
              bx1 = Math.max(bx1, x);
              by1 = Math.max(by1, y);
              hits++;
            }
          }
        }
        const useRefined = hits > 12 && bx1 > bx0 && by1 > by0;
        const x = useRefined ? Math.max(0, bx0 / w - padX) : Math.max(0, r.x0 / COLS - padX);
        const y = useRefined ? Math.max(0, by0 / h - padY) : Math.max(0, r.y0 / ROWS - padY);
        const rw = Math.min(
          1 - x,
          (useRefined ? (bx1 + 1) / w : (r.x1 + 1) / COLS) - x + padX,
        );
        const rh = Math.min(
          1 - y,
          (useRefined ? (by1 + 1) / h : (r.y1 + 1) / ROWS) - y + padY,
        );
        const ci = Math.min(ROWS - 1, Math.floor((y + rh / 2) * ROWS)) * COLS +
          Math.min(COLS - 1, Math.floor((x + rw / 2) * COLS));
        return { x, y, w: rw, h: rh, s: r.s, area: rw * rh, ci };
      })
      .filter((r) => r.area > 0.0025 && r.area < 0.5 && r.h < 0.55)
      .sort((a, b) => b.s * Math.sqrt(b.area) - a.s * Math.sqrt(a.area))
      .slice(0, 8);

    // remove retângulos muito sobrepostos (fica o de maior score)
    const keep: typeof out = [];
    for (const r of out) {
      const overlaps = keep.some((k) => {
        const ix = Math.max(0, Math.min(r.x + r.w, k.x + k.w) - Math.max(r.x, k.x));
        const iy = Math.max(0, Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y));
        const inter = ix * iy;
        return inter > 0.4 * Math.min(r.area, k.area);
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
      // sinal esporádico demais = provável falso positivo
      if (persistence < 0.3) continue;

      const alwaysOn = persistence > 0.85 || eMax - eMin < 0.05;
      const timeRanges = alwaysOn
        ? undefined
        : mergeRanges(onIdx.map((i) => stamps[i]!), step * 0.75, step * 1.6);

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

      // mediana temporal só recupera o fundo real quando a cena atrás se mexe
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
  } finally {
    v.src = "";
    if (typeof file !== "string") URL.revokeObjectURL(url);
  }
}
