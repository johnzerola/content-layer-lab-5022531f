/** Detecção e rastreamento de pessoas no vídeo (roda 100% no navegador).
 *
 *  Estratégia:
 *  1. amostra N frames ao longo do vídeo;
 *  2. tenta a API nativa FaceDetector; sem ela, usa detecção por tom de pele
 *     + energia de movimento por coluna;
 *  3. agrupa as detecções por proximidade → cada grupo vira um speaker;
 *  4. mede a atividade (variação de pixels) na região de cada pessoa para
 *     estimar quem está falando e sugerir os trechos. */

import {
  defaultSegment,
  newId,
  SPEAKER_COLORS,
  type FramingSegment,
  type Speaker,
  type SpeakerSample,
} from "./framing";

interface Det {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

type FaceDetectorLike = {
  detect: (src: CanvasImageSource) => Promise<{ boundingBox: { x: number; y: number; width: number; height: number } }[]>;
};

function makeFaceDetector(): FaceDetectorLike | null {
  const F = (globalThis as unknown as { FaceDetector?: new (o?: unknown) => FaceDetectorLike }).FaceDetector;
  if (!F) return null;
  try {
    return new F({ fastMode: true, maxDetectedFaces: 6 });
  } catch {
    return null;
  }
}

function seekTo(v: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    let done = false;
    const ok = () => {
      if (done) return;
      done = true;
      v.removeEventListener("seeked", ok);
      resolve();
    };
    v.addEventListener("seeked", ok);
    v.currentTime = Math.min(Math.max(0, t), Math.max(0, (v.duration || 0) - 0.05));
    window.setTimeout(ok, 900);
  });
}

/** Detecção simples por tom de pele: devolve até 4 aglomerados. */
function skinBlobs(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  const cols = 24;
  const rows = 16;
  const grid = new Float32Array(cols * rows);
  for (let y = 0; y < h; y += 2) {
    const gy = Math.min(rows - 1, Math.floor((y / h) * rows));
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const skin = r > 70 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 10;
      if (skin) grid[gy * cols + Math.min(cols - 1, Math.floor((x / w) * cols))]! += 1;
    }
  }
  const max = Math.max(...grid);
  if (max < 6) return [];
  const hot: { c: number; r: number; v: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = grid[r * cols + c]!;
      if (v > max * 0.45) hot.push({ c, r, v });
    }
  // agrupa células vizinhas
  const groups: { c: number; r: number; v: number }[][] = [];
  for (const cell of hot) {
    const g = groups.find((gr) => gr.some((o) => Math.abs(o.c - cell.c) <= 2 && Math.abs(o.r - cell.r) <= 2));
    if (g) g.push(cell);
    else groups.push([cell]);
  }
  return groups
    .sort((a, b) => b.reduce((s, o) => s + o.v, 0) - a.reduce((s, o) => s + o.v, 0))
    .slice(0, 4)
    .map((g) => {
      const cs = g.map((o) => o.c);
      const rs = g.map((o) => o.r);
      const x0 = Math.min(...cs) / cols;
      const x1 = (Math.max(...cs) + 1) / cols;
      const y0 = Math.min(...rs) / rows;
      const y1 = (Math.max(...rs) + 1) / rows;
      return { x: x0, y: y0, w: Math.max(0.08, x1 - x0), h: Math.max(0.1, y1 - y0) };
    });
}

export interface DetectResult {
  speakers: Speaker[];
  /** atividade por instante e por pessoa (0..1) */
  activity: { t: number; scores: Record<string, number> }[];
  source: "rosto" | "aproximada";
}

/** Analisa o vídeo e devolve as pessoas encontradas com suas posições no tempo. */
export async function detectSpeakers(
  file: File | Blob,
  opts?: { max?: number; onProgress?: (p: number) => void },
): Promise<DetectResult> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  try {
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error("vídeo não pôde ser lido"));
    });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    const samples = Math.max(6, Math.min(opts?.max ?? 48, Math.round(duration / 1.2) || 12));
    const W = 320;
    const H = Math.max(1, Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * W));
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    const fd = makeFaceDetector();
    let usedFaces = false;

    const dets: Det[] = [];
    const frames: { t: number; gray: Float32Array }[] = [];

    for (let i = 0; i < samples; i++) {
      const t = duration ? ((i + 0.5) / samples) * duration : 0;
      await seekTo(v, t);
      ctx.drawImage(v, 0, 0, W, H);
      const img = ctx.getImageData(0, 0, W, H);
      const gray = new Float32Array(W * H);
      for (let p = 0; p < W * H; p++) {
        gray[p] = (img.data[p * 4]! + img.data[p * 4 + 1]! + img.data[p * 4 + 2]!) / 3;
      }
      frames.push({ t, gray });

      let found: { x: number; y: number; w: number; h: number }[] = [];
      if (fd) {
        try {
          const faces = await fd.detect(cv);
          found = faces.map((f) => ({
            x: f.boundingBox.x / W,
            y: f.boundingBox.y / H,
            w: f.boundingBox.width / W,
            h: f.boundingBox.height / H,
          }));
          if (found.length) usedFaces = true;
        } catch {
          /* segue no fallback */
        }
      }
      if (!found.length) found = skinBlobs(img.data, W, H);
      for (const f of found) dets.push({ t, ...f });
      opts?.onProgress?.((i + 1) / samples);
    }

    // agrupa detecções por proximidade horizontal → cada grupo é uma pessoa
    const tracks: Det[][] = [];
    for (const d of dets) {
      const cx = d.x + d.w / 2;
      const g = tracks.find((tr) => {
        const last = tr[tr.length - 1]!;
        return Math.abs(last.x + last.w / 2 - cx) < 0.16;
      });
      if (g) g.push(d);
      else tracks.push([d]);
    }

    const speakers: Speaker[] = tracks
      .filter((tr) => tr.length >= 2)
      .sort((a, b) => b.length - a.length)
      .slice(0, 4)
      .map((tr, i) => {
        const avg = (f: (d: Det) => number) => tr.reduce((s, d) => s + f(d), 0) / tr.length;
        const box = { x: avg((d) => d.x), y: avg((d) => d.y), w: avg((d) => d.w), h: avg((d) => d.h) };
        const smp: SpeakerSample[] = tr.map((d) => ({ t: d.t, x: d.x, y: d.y, w: d.w, h: d.h }));
        return {
          id: `speaker_${i + 1}`,
          label: `Pessoa ${String.fromCharCode(65 + i)}`,
          color: SPEAKER_COLORS[i % SPEAKER_COLORS.length]!,
          box,
          samples: smp.sort((a, b) => a.t - b.t),
        };
      })
      .sort((a, b) => a.box.x - b.box.x)
      .map((s, i) => ({ ...s, id: `speaker_${i + 1}`, label: `Pessoa ${String.fromCharCode(65 + i)}`, color: SPEAKER_COLORS[i % SPEAKER_COLORS.length]! }));

    // atividade: variação de pixels na região de cada pessoa entre frames
    const activity: DetectResult["activity"] = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1]!.gray;
      const b = frames[i]!.gray;
      const scores: Record<string, number> = {};
      for (const sp of speakers) {
        const x0 = Math.floor(sp.box.x * W);
        const x1 = Math.min(W, Math.ceil((sp.box.x + sp.box.w) * W));
        const y0 = Math.floor(sp.box.y * H);
        const y1 = Math.min(H, Math.ceil((sp.box.y + sp.box.h) * H));
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const p = y * W + x;
            sum += Math.abs(a[p]! - b[p]!);
            n++;
          }
        scores[sp.id] = n ? sum / n / 40 : 0;
      }
      activity.push({ t: frames[i]!.t, scores });
    }

    return { speakers, activity, source: usedFaces ? "rosto" : "aproximada" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Sugere trechos de enquadramento a partir das pessoas + atividade.
 *  Usa debounce para não gerar uma troca a cada ruído. */
export function suggestSegments(
  det: DetectResult,
  duration: number,
  srcW: number,
  srcH: number,
  opts?: { minSeg?: number },
): FramingSegment[] {
  const minSeg = opts?.minSeg ?? 3.5;
  const sps = det.speakers;
  if (!sps.length) return [];
  if (sps.length === 1) {
    return [defaultSegment(0, srcW, srcH, "single", sps[0]!)];
  }

  // vencedor por amostra, com suavização de 3 pontos
  const raw = det.activity.map((a) => {
    let best = sps[0]!.id;
    let bv = -1;
    let second = -1;
    for (const sp of sps) {
      const v = a.scores[sp.id] ?? 0;
      if (v > bv) {
        second = bv;
        bv = v;
        best = sp.id;
      } else if (v > second) second = v;
    }
    const close = bv > 0 && second > bv * 0.72;
    return { t: a.t, id: best, close };
  });
  const smooth = raw.map((r, i) => {
    const win = raw.slice(Math.max(0, i - 1), i + 2);
    const counts = new Map<string, number>();
    for (const w of win) counts.set(w.id, (counts.get(w.id) ?? 0) + 1);
    let id = r.id;
    let n = 0;
    counts.forEach((v, k) => {
      if (v > n) {
        n = v;
        id = k;
      }
    });
    return { t: r.t, id, close: r.close };
  });

  // agrupa em trechos e descarta os curtos demais
  type Run = { start: number; end: number; id: string; close: boolean };
  const runs: Run[] = [];
  for (const s of smooth) {
    const last = runs[runs.length - 1];
    if (last && last.id === s.id) {
      last.end = s.t;
      last.close = last.close || s.close;
    } else runs.push({ start: last ? last.end : 0, end: s.t, id: s.id, close: s.close });
  }
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.end - r.start < minSeg) {
      last.end = r.end;
      last.close = last.close || r.close;
    } else merged.push({ ...r });
  }
  if (merged.length) {
    merged[0]!.start = 0;
    merged[merged.length - 1]!.end = duration;
  }

  return merged.map((r) => {
    const sp = sps.find((s) => s.id === r.id) ?? sps[0]!;
    if (r.close && sps.length > 1) {
      const other = sps.find((s) => s.id !== sp.id) ?? sps[0]!;
      const seg = defaultSegment(r.start, srcW, srcH, "split", sp);
      const bottom = seg.targets.find((t) => t.slot === "bottom");
      if (bottom) {
        const c = { x: other.box.x + other.box.w / 2, y: other.box.y + other.box.h / 2 };
        const w = Math.min(1, (9 / 8 / (srcW / srcH)) || 0.6);
        bottom.speaker = other.id;
        bottom.track = true;
        bottom.x = Math.max(0, Math.min(1 - w, c.x - w / 2));
        bottom.y = 0;
        bottom.w = w;
        bottom.h = 1;
      }
      return { ...seg, id: newId() };
    }
    return { ...defaultSegment(r.start, srcW, srcH, "single", sp), id: newId() };
  });
}
