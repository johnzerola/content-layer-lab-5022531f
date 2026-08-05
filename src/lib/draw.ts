import {
  CANVAS_H,
  CANVAS_W,
  type CaptionStyle,
  type ImageLayer,
  type Template,
  type TextLayer,
} from "./template";
import type { CaptionCue } from "./captions";

const imgCache = new Map<string, HTMLImageElement>();

export function getImage(src: string): HTMLImageElement | null {
  const cached = imgCache.get(src);
  if (cached) return cached.complete && cached.naturalWidth ? cached : null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  imgCache.set(src, img);
  return null;
}

export function preloadImage(src: string) {
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgCache.set(src, img);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, txt: string, maxW: number) {
  const lines: string[] = [];
  for (const paragraph of txt.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** Aplica rotação em torno do centro da caixa da camada. */
function withTransform(
  ctx: CanvasRenderingContext2D,
  l: { x: number; y: number; w: number; h: number; rotation?: number; opacity?: number },
  fn: () => void,
) {
  ctx.save();
  if (l.opacity != null && l.opacity !== 1) ctx.globalAlpha = l.opacity;
  if (l.rotation) {
    const cx = l.x + l.w / 2;
    const cy = l.y + l.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((l.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  fn();
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  if (!l.visible || !l.text) return;
  withTransform(ctx, l, () => {
    ctx.font = `${l.weight} ${l.size}px ${l.font}`;
    ctx.textBaseline = "top";
    const lines = wrap(ctx, l.text, l.w);
    const lh = l.size * 1.18;
    lines.forEach((line, i) => {
      const y = l.y + i * lh;
      let x = l.x;
      const width = ctx.measureText(line).width;
      if (l.align === "center") x = l.x + (l.w - width) / 2;
      if (l.align === "right") x = l.x + l.w - width;

      if (l.accentColor && l.accentTo != null && l.accentFrom != null && lines.length === 1) {
        const a = l.text.slice(0, l.accentFrom);
        const b = l.text.slice(l.accentFrom, l.accentTo);
        const c = l.text.slice(l.accentTo);
        let cx = x;
        ctx.fillStyle = l.color;
        ctx.fillText(a, cx, y);
        cx += ctx.measureText(a).width;
        ctx.fillStyle = l.accentColor;
        ctx.fillText(b, cx, y);
        cx += ctx.measureText(b).width;
        ctx.fillStyle = l.color;
        ctx.fillText(c, cx, y);
      } else {
        ctx.fillStyle = l.color;
        ctx.fillText(line, x, y);
      }

      if (l.badge && i === lines.length - 1) {
        const bx = x + width + l.size * 0.25;
        const by = y + l.size * 0.32;
        const r = l.size * 0.28;
        ctx.fillStyle = "#1d9bf0";
        ctx.beginPath();
        ctx.arc(bx + r, by + r, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(2, r * 0.22);
        ctx.beginPath();
        ctx.moveTo(bx + r * 0.55, by + r);
        ctx.lineTo(bx + r * 0.9, by + r * 1.38);
        ctx.lineTo(bx + r * 1.45, by + r * 0.62);
        ctx.stroke();
      }
    });
  });
}

function drawImageLayer(ctx: CanvasRenderingContext2D, l: ImageLayer) {
  if (!l.visible || !l.src) return;
  const img = getImage(l.src);
  if (!img) return;
  withTransform(ctx, { ...l, opacity: 1 }, () => {
    ctx.globalAlpha = l.opacity;
    if (l.round) {
      ctx.beginPath();
      ctx.arc(l.x + l.w / 2, l.y + l.h / 2, Math.min(l.w, l.h) / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    const scale = Math.max(l.w / img.width, l.h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, l.x + (l.w - dw) / 2, l.y + (l.h - dh) / 2, dw, dh);
  });
}

/* ---------------------------------------------------------------- legendas */

function chunkWords<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function drawCaptions(
  ctx: CanvasRenderingContext2D,
  s: CaptionStyle,
  cues: CaptionCue[],
  time: number,
) {
  if (!s.visible || !cues.length) return;
  const cue = cues.find((c) => time >= c.start && time <= c.end);
  if (!cue) return;

  const groups = chunkWords(cue.words, Math.max(1, s.maxWords));
  const gi = groups.findIndex(
    (g) => time >= (g[0]?.start ?? 0) && time <= (g[g.length - 1]?.end ?? 0),
  );
  const group = groups[gi >= 0 ? gi : groups.length - 1];
  if (!group || !group.length) return;

  const groupStart = group[0]?.start ?? 0;
  const activeIdx = group.findIndex((w) => time >= w.start && time <= w.end);
  const shown = s.mode === "word" ? [group[Math.max(0, activeIdx)]!] : group;

  // animação de entrada do bloco
  const anim = s.anim ?? "none";
  const since = Math.max(0, time - (s.mode === "word" ? (shown[0]?.start ?? groupStart) : groupStart));
  const p = Math.min(1, since / 0.22);
  let scaleIn = 1;
  let slideY = 0;
  let alphaIn = 1;
  if (anim === "pop") scaleIn = 0.72 + 0.28 * (1 - (1 - p) ** 3);
  else if (anim === "bounce") scaleIn = 1 + 0.18 * Math.sin(Math.PI * p) * (1 - p);
  else if (anim === "slide") slideY = (1 - (1 - p) ** 3) * 0 + (1 - p) * s.size * 0.7;
  else if (anim === "fade") alphaIn = p;

  ctx.save();
  ctx.globalAlpha = (s.opacity ?? 1) * alphaIn;
  ctx.font = `${s.weight} ${s.size}px ${s.font}`;
  ctx.textBaseline = "top";

  const norm = (txt: string) => (s.uppercase ? txt.toUpperCase() : txt);
  const space = ctx.measureText(" ").width;

  // typewriter: revela apenas as palavras já faladas
  const visible =
    anim === "typewriter" ? shown.filter((w) => time >= w.start - 0.02) : shown;
  const words = visible.length ? visible : [shown[0]!];

  // quebra em linhas respeitando a largura da caixa
  const allLines: (typeof words)[] = [];
  let line: typeof words = [];
  let lineW = 0;
  for (const w of words) {
    const ww = ctx.measureText(norm(w.text)).width;
    if (line.length && lineW + space + ww > s.w) {
      allLines.push(line);
      line = [];
      lineW = 0;
    }
    line.push(w);
    lineW += (line.length > 1 ? space : 0) + ww;
  }
  if (line.length) allLines.push(line);

  // limita o número de linhas visíveis (mantém as que contêm a palavra atual)
  const maxLines = Math.max(1, s.maxLines ?? 2);
  let lines = allLines;
  if (allLines.length > maxLines) {
    const cur = Math.max(
      0,
      allLines.findIndex((ln) => ln.some((w) => time >= w.start && time <= w.end)),
    );
    const start = Math.min(Math.max(0, cur - maxLines + 1), allLines.length - maxLines);
    lines = allLines.slice(start, start + maxLines);
  }

  const lh = s.size * (s.lineHeight ?? 1.2);
  const totalH = lines.length * lh;
  const startY = s.y + Math.max(0, (s.h - totalH) / 2) + slideY;
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;

  if (scaleIn !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(scaleIn, scaleIn);
    ctx.translate(-cx, -cy);
  }

  const highlight = s.highlight ?? "color";
  const hlColor = s.highlightColor ?? s.activeColor;

  if (s.bg === "box") {
    const pad = s.size * (s.boxPad ?? 0.28);
    let maxW = 0;
    for (const ln of lines) {
      const wSum = ln.reduce((acc, w, i) => acc + (i ? space : 0) + ctx.measureText(norm(w.text)).width, 0);
      maxW = Math.max(maxW, wSum);
    }
    const bx =
      s.align === "left" ? s.x : s.align === "right" ? s.x + s.w - maxW : s.x + (s.w - maxW) / 2;
    ctx.fillStyle = s.boxColor;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * (s.boxOpacity ?? 0.65);
    roundRect(
      ctx,
      bx - pad,
      startY - pad * 0.7,
      maxW + pad * 2,
      totalH + pad * 1.4,
      s.size * (s.boxRadius ?? 0.18),
    );
    ctx.fill();
    ctx.globalAlpha = prev;
  }


  lines.forEach((ln, li) => {
    const widths = ln.map((w) => ctx.measureText(norm(w.text)).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (ln.length - 1);
    let x =
      s.align === "left" ? s.x : s.align === "right" ? s.x + s.w - total : s.x + (s.w - total) / 2;
    const y = startY + li * lh;

    ln.forEach((w, i) => {
      const txt = norm(w.text);
      const ww = widths[i] ?? 0;
      const active = s.mode !== "line" && time >= w.start && time <= w.end;

      if (active && highlight === "box") {
        const pad = s.size * 0.16;
        ctx.fillStyle = hlColor;
        roundRect(ctx, x - pad, y - pad * 0.5, ww + pad * 2, s.size * 1.15 + pad, s.size * 0.16);
        ctx.fill();
      }

      ctx.save();
      if (active && highlight === "scale") {
        ctx.translate(x + ww / 2, y + s.size * 0.55);
        ctx.scale(1.14, 1.14);
        ctx.translate(-(x + ww / 2), -(y + s.size * 0.55));
      }

      if (s.bg === "shadow") {
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = s.size * 0.25;
        ctx.shadowOffsetY = s.size * 0.06;
      }
      if (s.stroke > 0) {
        ctx.lineJoin = "round";
        ctx.lineWidth = s.stroke;
        ctx.strokeStyle = s.strokeColor;
        ctx.strokeText(txt, x, y);
      }
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle =
        s.mode === "line"
          ? s.color
          : active
            ? highlight === "box"
              ? s.activeColor
              : highlight === "color" || highlight === "scale"
                ? s.activeColor
                : s.color
            : s.color;
      ctx.fillText(txt, x, y);
      ctx.restore();

      if (active && highlight === "underline") {
        ctx.fillStyle = hlColor;
        ctx.fillRect(x, y + s.size * 1.12, ww, Math.max(3, s.size * 0.08));
      }

      x += ww + space;
    });
  });

  ctx.restore();
}


export interface FrameSource {
  el: CanvasImageSource;
  width: number;
  height: number;
}

let noiseTile: HTMLCanvasElement | null = null;
function getNoiseTile() {
  if (noiseTile) return noiseTile;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const cx = c.getContext("2d")!;
  const img = cx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 36;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

export interface DrawOpts {
  mirror?: boolean;
  offsetX?: number;
  offsetY?: number;
  brightness?: number;
  saturation?: number;
  zoom?: number;
  noise?: number;
  /** rotação anti-duplicidade aplicada ao vídeo (graus) */
  rotate?: number;
  /** moldura anti-duplicidade em px */
  border?: number;
  borderColor?: string;
  /** tempo atual do vídeo fonte (segundos) — usado pelas legendas */
  time?: number;
  captions?: CaptionCue[];
}

function drawVideoLayer(
  ctx: CanvasRenderingContext2D,
  t: Template,
  source?: FrameSource | null,
  opts?: DrawOpts,
) {
  const v = t.video;
  if (!v.visible) return;
  const border = opts?.border ?? 0;
  if (border > 0) {
    ctx.save();
    ctx.fillStyle = opts?.borderColor ?? "#000";
    roundRect(ctx, v.x - border, v.y - border, v.w + border * 2, v.h + border * 2, v.radius + border);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  const rot = (v.rotation ?? 0) + (opts?.rotate ?? 0);
  if (rot) {
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  roundRect(ctx, v.x, v.y, v.w, v.h, v.radius);
  ctx.clip();
  if (source && source.width) {
    // a rotação exige um leve zoom extra pra não aparecer canto vazio
    const rotPad = rot ? 1 + Math.abs(rot) / 40 : 1;
    const zoom = (opts?.zoom ?? 1) * rotPad;
    const scale = Math.max(v.w / source.width, v.h / source.height) * zoom;
    const dw = source.width * scale;
    const dh = source.height * scale;
    const ox = (opts?.offsetX ?? v.offsetX) * (dw - v.w) * 0.5;
    const oy = (opts?.offsetY ?? v.offsetY) * (dh - v.h) * 0.5;
    const dx = v.x + (v.w - dw) / 2 + ox;
    const dy = v.y + (v.h - dh) / 2 + oy;
    if (opts?.mirror ?? t.mirror) {
      ctx.translate(v.x * 2 + v.w, 0);
      ctx.scale(-1, 1);
    }
    const b = opts?.brightness ?? 1;
    const s = opts?.saturation ?? 1;
    if (b !== 1 || s !== 1) ctx.filter = `brightness(${b}) saturate(${s})`;
    ctx.drawImage(source.el, dx, dy, dw, dh);
    ctx.filter = "none";
    if (opts?.noise) {
      ctx.globalAlpha = Math.min(0.12, opts.noise);
      ctx.globalCompositeOperation = "overlay";
      const pat = ctx.createPattern(getNoiseTile(), "repeat");
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(v.x, v.y, v.w, v.h);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(v.x, v.y, v.w, v.h);
  }
  ctx.restore();
  applyCleanup(ctx, v, t.cleanup);
}

let scratch: HTMLCanvasElement | null = null;
function getScratch(w: number, h: number) {
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch;
}

/** Remove legenda queimada / marca d'água / texto do vídeo original dentro das máscaras. */
export function applyCleanup(
  ctx: CanvasRenderingContext2D,
  v: { x: number; y: number; w: number; h: number; radius: number },
  regions?: CleanupRegion[],
) {
  const list = (regions ?? []).filter((r) => r.enabled && r.w > 0 && r.h > 0);
  if (!list.length) return;
  const canvas = ctx.canvas;

  for (const r of list) {
    const x = Math.round(v.x + r.x * v.w);
    const y = Math.round(v.y + r.y * v.h);
    const w = Math.round(r.w * v.w);
    const h = Math.round(r.h * v.h);
    if (w < 2 || h < 2) continue;
    const k = Math.max(1, Math.min(100, r.strength || 50)) / 100;

    ctx.save();
    roundRect(ctx, v.x, v.y, v.w, v.h, v.radius);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    if (r.mode === "solid") {
      ctx.fillStyle = r.color ?? "#000000";
      ctx.fillRect(x, y, w, h);
    } else if (r.mode === "pixelate") {
      const px = Math.max(2, Math.round(Math.min(w, h) * 0.5 * k));
      const sw = Math.max(1, Math.round(w / px));
      const sh = Math.max(1, Math.round(h / px));
      const s = getScratch(sw, sh);
      const sc = s.getContext("2d");
      if (sc) {
        sc.clearRect(0, 0, sw, sh);
        sc.drawImage(canvas, x, y, w, h, 0, 0, sw, sh);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(s, 0, 0, sw, sh, x, y, w, h);
        ctx.imageSmoothingEnabled = true;
      }
    } else if (r.mode === "blur") {
      const pad = Math.round(Math.min(w, h) * 0.4) + 8;
      const sx = Math.max(0, x - pad);
      const sy = Math.max(0, y - pad);
      const sw = Math.min(canvas.width - sx, w + pad * 2);
      const sh = Math.min(canvas.height - sy, h + pad * 2);
      const s = getScratch(sw, sh);
      const sc = s.getContext("2d");
      if (sc) {
        sc.clearRect(0, 0, sw, sh);
        sc.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        ctx.filter = `blur(${Math.max(3, Math.round(Math.min(w, h) * 0.35 * k))}px)`;
        ctx.drawImage(s, sx, sy);
        ctx.filter = "none";
      }
    } else {
      // smear: clona a faixa vizinha por cima da área (inpaint simples)
      const from = r.from ?? "top";
      const bandBase = Math.max(4, Math.round((from === "left" || from === "right" ? w : h) * 0.25));
      const band = Math.max(3, Math.round(bandBase * (0.4 + k)));
      let sx = x;
      let sy = y;
      let sw = w;
      let sh = h;
      if (from === "top") {
        sy = Math.max(0, y - band);
        sh = Math.min(band, y);
      } else if (from === "bottom") {
        sy = Math.min(canvas.height - 1, y + h);
        sh = Math.min(band, canvas.height - sy);
      } else if (from === "left") {
        sx = Math.max(0, x - band);
        sw = Math.min(band, x);
      } else {
        sx = Math.min(canvas.width - 1, x + w);
        sw = Math.min(band, canvas.width - sx);
      }
      if (sw > 0 && sh > 0) {
        const s = getScratch(sw, sh);
        const sc = s.getContext("2d");
        if (sc) {
          sc.clearRect(0, 0, sw, sh);
          sc.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
          ctx.filter = `blur(${Math.max(2, Math.round(Math.min(w, h) * 0.12))}px)`;
          ctx.drawImage(s, 0, 0, sw, sh, x, y, w, h);
          // segunda passada espelhada suaviza a emenda
          ctx.globalAlpha = 0.5;
          ctx.save();
          ctx.translate(x, y + h);
          ctx.scale(1, -1);
          ctx.drawImage(s, 0, 0, sw, sh, 0, 0, w, h);
          ctx.restore();
          ctx.globalAlpha = 1;
          ctx.filter = "none";
        }
      }
    }
    ctx.restore();
  }
}


export function drawFrame(
  ctx: CanvasRenderingContext2D,
  t: Template,
  source?: FrameSource | null,
  opts?: DrawOpts,
) {
  const W = t.canvasW ?? CANVAS_W;
  const H = t.canvasH ?? CANVAS_H;
  ctx.save();
  ctx.fillStyle = t.background;
  ctx.fillRect(0, 0, W, H);

  // ordem de empilhamento configurável (z-index por camada)
  const jobs: { z: number; i: number; run: () => void }[] = [];
  const push = (z: number | undefined, fallback: number, run: () => void) =>
    jobs.push({ z: z ?? fallback, i: jobs.length, run });

  push(t.video.z, 0, () => drawVideoLayer(ctx, t, source, opts));
  push(t.watermark.z, 10, () => drawImageLayer(ctx, t.watermark));
  push(t.avatar.z, 20, () => drawImageLayer(ctx, t.avatar));
  push(t.name_.z, 30, () => drawText(ctx, t.name_));
  push(t.handle.z, 40, () => drawText(ctx, t.handle));
  push(t.headline.z, 50, () => drawText(ctx, t.headline));
  push(t.cta.z, 60, () => drawText(ctx, t.cta));
  (t.extras ?? []).forEach((extra, i) =>
    push(extra.z, 100 + i, () => ("src" in extra ? drawImageLayer(ctx, extra) : drawText(ctx, extra))),
  );
  if (t.captions && opts?.captions?.length) {
    const cues = opts.captions;
    const time = opts.time ?? 0;
    push(t.captions.z, 70, () => drawCaptions(ctx, t.captions!, cues, time));
  }

  jobs.sort((a, b) => a.z - b.z || a.i - b.i).forEach((j) => j.run());
  ctx.restore();
}
