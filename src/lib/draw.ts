import { CANVAS_H, CANVAS_W, type ImageLayer, type Template, type TextLayer } from "./template";

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

function drawText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  if (!l.visible || !l.text) return;
  ctx.save();
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
  ctx.restore();
}

function drawImageLayer(ctx: CanvasRenderingContext2D, l: ImageLayer) {
  if (!l.visible || !l.src) return;
  const img = getImage(l.src);
  if (!img) return;
  ctx.save();
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
  ctx.restore();
}

export interface FrameSource {
  el: CanvasImageSource;
  width: number;
  height: number;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  t: Template,
  source?: FrameSource | null,
  opts?: { mirror?: boolean; offsetX?: number; offsetY?: number },
) {
  ctx.save();
  ctx.fillStyle = t.background;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const v = t.video;
  if (v.visible) {
    ctx.save();
    roundRect(ctx, v.x, v.y, v.w, v.h, v.radius);
    ctx.clip();
    if (source && source.width) {
      const scale = Math.max(v.w / source.width, v.h / source.height);
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
      ctx.drawImage(source.el, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(v.x, v.y, v.w, v.h);
    }
    ctx.restore();
  }

  drawImageLayer(ctx, t.watermark);
  drawImageLayer(ctx, t.avatar);
  drawText(ctx, t.name_);
  drawText(ctx, t.handle);
  drawText(ctx, t.headline);
  drawText(ctx, t.cta);
  ctx.restore();
}
