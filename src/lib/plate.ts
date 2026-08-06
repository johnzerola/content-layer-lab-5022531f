import type { CleanupRegion } from "@/lib/template";

/**
 * Placa de fundo por mediana temporal.
 *
 * Para cada área marcada, olhamos o mesmo retângulo em vários instantes do vídeo:
 * o overlay (marca d'água/legenda) fica sempre igual, o fundo muda. A mediana de
 * cada pixel devolve o FUNDO REAL — pixels verdadeiros do vídeo, sem borrão e sem
 * invenção de IA. É a mesma ideia usada pelos removedores online.
 *
 * Quando não há movimento suficiente atrás da área, a mediana devolveria o próprio
 * overlay: nesse caso o render cai para o inpaint (Telea + exemplar).
 */

export type Plate = {
  canvas: HTMLCanvasElement;
  /** ids das regiões que a placa consegue cobrir com fundo real */
  ok: Set<string>;
};

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

function medianOf(values: number[]) {
  values.sort((a, b) => a - b);
  const n = values.length;
  return n % 2 ? values[(n - 1) / 2]! : Math.round((values[n / 2 - 1]! + values[n / 2]!) / 2);
}

export async function buildBackgroundPlate(
  file: File | string,
  regions: CleanupRegion[],
  opts: { frames?: number; clip?: { start: number; end: number }; signal?: AbortSignal } = {},
): Promise<Plate | null> {
  const list = regions.filter((r) => r.enabled && r.w > 0 && r.h > 0 && (r.recover ?? "median") !== "inpaint");
  if (!list.length) return null;

  const url = typeof file === "string" ? file : URL.createObjectURL(file);
  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  v.crossOrigin = "anonymous";
  v.preload = "auto";

  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("não consegui decodificar este vídeo"));
      setTimeout(() => reject(new Error("tempo esgotado ao abrir o vídeo")), 20000);
    });

    const W = v.videoWidth;
    const H = v.videoHeight;
    if (!W || !H) return null;

    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    const start = Math.max(0, opts.clip?.start ?? 0);
    const end = Math.min(dur || 1e9, opts.clip?.end ?? (dur || 1));
    const span = Math.max(0.2, end - start);
    const n = Math.max(6, Math.min(14, opts.frames ?? 11));

    const frame = document.createElement("canvas");
    frame.width = W;
    frame.height = H;
    const fctx = frame.getContext("2d", { willReadFrequently: true });
    if (!fctx) return null;

    const plate = document.createElement("canvas");
    plate.width = W;
    plate.height = H;
    const pctx = plate.getContext("2d", { willReadFrequently: true });
    if (!pctx) return null;

    // retângulos em pixels, com folga para o feather das bordas
    const boxes = list.map((r) => {
      const padX = Math.round(r.w * W * 0.06) + 4;
      const padY = Math.round(r.h * H * 0.08) + 4;
      const x = Math.max(0, Math.floor(r.x * W) - padX);
      const y = Math.max(0, Math.floor(r.y * H) - padY);
      const w = Math.min(W - x, Math.ceil(r.w * W) + padX * 2);
      const h = Math.min(H - y, Math.ceil(r.h * H) + padY * 2);
      return { r, x, y, w, h, samples: [] as Uint8ClampedArray[] };
    });

    for (let k = 0; k < n; k++) {
      if (opts.signal?.aborted) throw new Error("cancelado");
      const t = start + (span * (k + 0.5)) / n;
      await seek(v, Math.min(t, Math.max(0, end - 0.05)));
      fctx.drawImage(v, 0, 0, W, H);
      for (const b of boxes) {
        if (b.w < 2 || b.h < 2) continue;
        b.samples.push(fctx.getImageData(b.x, b.y, b.w, b.h).data);
      }
    }

    const ok = new Set<string>();
    for (const b of boxes) {
      const s = b.samples;
      if (s.length < 4 || b.w < 2 || b.h < 2) continue;
      const out = pctx.createImageData(b.w, b.h);
      const px = b.w * b.h;
      let movement = 0;
      const chan = [0, 1, 2];
      const vals: number[] = new Array(s.length);
      for (let p = 0; p < px; p++) {
        const i = p * 4;
        for (const ch of chan) {
          for (let k = 0; k < s.length; k++) vals[k] = s[k]![i + ch]!;
          const m = medianOf(vals.slice());
          out.data[i + ch] = m;
          if (ch === 1) {
            let d = 0;
            for (let k = 0; k < s.length; k++) d += Math.abs(s[k]![i + 1]! - m);
            movement += d / s.length;
          }
        }
        out.data[i + 3] = 255;
      }
      // fundo precisa se mexer atrás do overlay para a mediana revelar o original
      const meanDelta = movement / Math.max(1, px);
      if (meanDelta < 4) continue;
      pctx.putImageData(out, b.x, b.y);
      ok.add(b.r.id);
    }

    if (!ok.size) return null;
    return { canvas: plate, ok };
  } finally {
    v.src = "";
    if (typeof file !== "string") URL.revokeObjectURL(url);
  }
}
