import type { Box, FrameSet } from "@/lib/detect-core";

/**
 * Fixtures sintéticas: cenas com fundo em movimento + overlays estáticos ou
 * intermitentes. Servem para medir cobertura da detecção e falsos positivos
 * sem depender de vídeo real / navegador.
 */

export type Fixture = {
  name: string;
  set: FrameSet;
  truths: Box[];
};

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

type Overlay = {
  box: Box;
  /** 0..1 — intensidade do overlay (1 = opaco) */
  alpha: number;
  /** índices dos quadros em que aparece; undefined = sempre */
  frames?: (k: number, n: number) => boolean;
  /** textura: linhas de "texto" ou bloco de logo */
  kind: "text" | "logo";
};

export function makeScene(opts: {
  name: string;
  w?: number;
  h?: number;
  n?: number;
  overlays: Overlay[];
  seed?: number;
}): Fixture {
  const w = opts.w ?? 216;
  const h = opts.h ?? 384;
  const n = opts.n ?? 12;
  const rand = rnd(opts.seed ?? 7);
  const frames: Float32Array[] = [];
  const stamps: number[] = [];

  // fundo: gradiente + blobs que se movem a cada quadro (cena viva)
  const blobs = Array.from({ length: 14 }, () => ({
    x: rand(),
    y: rand(),
    r: 0.08 + rand() * 0.18,
    v: 0.02 + rand() * 0.05,
    p: rand() * 6.28,
    tone: rand(),
  }));

  for (let k = 0; k < n; k++) {
    const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / h;
        let val = 0.35 + 0.25 * v + 0.1 * Math.sin(u * 9 + k * 0.6);
        for (const b of blobs) {
          const bx = (b.x + Math.cos(b.p + k * b.v * 3) * 0.25 + 1) % 1;
          const by = (b.y + Math.sin(b.p + k * b.v * 3) * 0.25 + 1) % 1;
          const d = Math.hypot(u - bx, (v - by) * (h / w));
          if (d < b.r) val += (1 - d / b.r) * (b.tone - 0.5) * 0.9;
        }
        val += (rand() - 0.5) * 0.03;
        g[y * w + x] = Math.min(1, Math.max(0, val));
      }
    }

    for (const o of opts.overlays) {
      if (o.frames && !o.frames(k, n)) continue;
      const x0 = Math.round(o.box.x * w);
      const x1 = Math.round((o.box.x + o.box.w) * w);
      const y0 = Math.round(o.box.y * h);
      const y1 = Math.round((o.box.y + o.box.h) * h);
      const bh = Math.max(1, y1 - y0);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          let ink = 0;
          if (o.kind === "text") {
            // "glifos": colunas alternadas com entrelinha
            const row = Math.floor(((y - y0) / bh) * Math.max(1, Math.round(bh / 6)));
            const inGlyph = (x - x0 + row * 3) % 5 < 3 && (y - y0) % 6 < 4;
            ink = inGlyph ? 1 : 0;
          } else {
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            const d = Math.hypot((x - cx) / Math.max(1, (x1 - x0) / 2), (y - cy) / Math.max(1, bh / 2));
            ink = d < 0.9 ? 1 : 0;
            if (d < 0.5) ink = 0; // anel: gera bordas internas como um logo real
          }
          if (!ink) continue;
          const p = y * w + x;
          g[p] = g[p]! * (1 - o.alpha) + 0.98 * o.alpha;
        }
      }
    }

    frames.push(g);
    stamps.push((k + 0.5) * (10 / n));
  }

  return {
    name: opts.name,
    set: { frames, w, h, stamps, span: 10 },
    truths: opts.overlays.map((o) => o.box),
  };
}

export function fixtures(): Fixture[] {
  return [
    makeScene({
      name: "legenda de rodapé intermitente",
      seed: 11,
      overlays: [
        {
          box: { x: 0.12, y: 0.78, w: 0.76, h: 0.08 },
          alpha: 1,
          kind: "text",
          frames: (k) => k % 3 !== 2,
        },
      ],
    }),
    makeScene({
      name: "marca d'água pequena no canto superior direito",
      seed: 23,
      overlays: [{ box: { x: 0.68, y: 0.04, w: 0.26, h: 0.05 }, alpha: 0.75, kind: "text" }],
    }),
    makeScene({
      name: "logo circular no canto inferior esquerdo",
      seed: 31,
      overlays: [{ box: { x: 0.04, y: 0.87, w: 0.14, h: 0.08 }, alpha: 0.9, kind: "logo" }],
    }),
    makeScene({
      name: "legenda + marca d'água juntas",
      seed: 47,
      overlays: [
        { box: { x: 0.1, y: 0.76, w: 0.8, h: 0.09 }, alpha: 1, kind: "text", frames: (k) => k % 4 !== 3 },
        { box: { x: 0.7, y: 0.05, w: 0.24, h: 0.05 }, alpha: 0.8, kind: "text" },
      ],
    }),
    makeScene({
      name: "cena limpa (sem overlay)",
      seed: 59,
      overlays: [],
    }),
  ];
}
