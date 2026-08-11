import {
  CANVAS_H,
  CANVAS_W,
  type CaptionStyle,
  type CleanupRegion,
  type ImageLayer,
  type Template,
  type TextLayer,
} from "./template";
import type { CaptionCue } from "./captions";
import { cropRect, cropAt, isFullCrop, preEditFilter, transitionAt, type PreEdit } from "./preedit";

/** Fallback local para regiões de limpeza quando o motor IA não está disponível.
 *  O processamento profissional agora acontece no backend Python (CleanerIA).
 */
function inpaintArea(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const canvas = ctx.canvas;
  const pad = Math.max(8, Math.round(Math.min(w, h) * 0.6));
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sw = Math.min(canvas.width - sx, w + pad * 2);
  const sh = Math.min(canvas.height - sy, h + pad * 2);
  if (sw < 4 || sh < 4) return;
  const work = document.createElement("canvas");
  work.width = sw;
  work.height = sh;
  const wc = work.getContext("2d", { willReadFrequently: true });
  if (!wc) return;
  wc.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  const data = wc.getImageData(0, 0, sw, sh).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]!;
    g += data[i + 1]!;
    b += data[i + 2]!;
    n++;
  }
  ctx.fillStyle = n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : "#000000";
  ctx.fillRect(x, y, w, h);
}





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
  /** tempo atual do vídeo fonte (segundos) — usado pelas legendas e janelas de limpeza */
  time?: number;
  captions?: CaptionCue[];
  /** placa de fundo (mediana temporal) para reconstruir áreas com pixels reais */
  plate?: { canvas: HTMLCanvasElement; ok: Set<string> } | null;
  /** pré-edição do vídeo fonte (recorte, giro, cor) aplicada antes do template */
  pre?: PreEdit | null;
  /** janela exportada — usada pelas transições de abertura/saída */
  clip?: { start: number; end: number } | null;
  /** "hq" = reconstrução em resolução total (exportação). Padrão: preview rápido. */
  quality?: "preview" | "hq";
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
  let dest: { dx: number; dy: number; dw: number; dh: number; mirror: boolean } | null = null;
  if (source && source.width) {
    // pré-edição do vídeo fonte (recorte, giro, espelho e cor)
    const pre = opts?.pre;
    const cr = cropRect(pre, source.width, source.height, opts?.time);
    // a rotação exige um leve zoom extra pra não aparecer canto vazio
    const rotPad = rot ? 1 + Math.abs(rot) / 40 : 1;
    const zoom = (opts?.zoom ?? 1) * rotPad;
    const srcAR = cr.ew / cr.eh;
    const boxAR = v.w / v.h;
    // recorte manual: o que o usuário selecionou tem que aparecer inteiro,
    // senão o "cover" reenquadra e o corte vira só um zoom
    const manualCrop = !isFullCrop(cropAt(pre, opts?.time));
    const layout = pre?.layout ?? "auto";
    const mirror = Boolean(opts?.mirror ?? t.mirror);
    if (mirror) {
      ctx.translate(v.x * 2 + v.w, 0);
      ctx.scale(-1, 1);
    }
    const baseFilter = preEditFilter(pre, {
      brightness: opts?.brightness ?? 1,
      saturation: opts?.saturation ?? 1,
    });

    /** Desenha a fonte dentro de uma caixa, no modo pedido. */
    const paint = (
      box: { x: number; y: number; w: number; h: number },
      mode: "cover" | "contain",
      rect: typeof cr = cr,
      style?: { blur?: number; dim?: number; useOffset?: boolean },
    ) => {
      const fitScale =
        mode === "contain"
          ? Math.min(box.w / rect.ew, box.h / rect.eh)
          : Math.max(box.w / rect.ew, box.h / rect.eh);
      const scale = fitScale * zoom;
      const dw = rect.ew * scale;
      const dh = rect.eh * scale;
      const useOffset = style?.useOffset !== false;
      const ox = useOffset ? (opts?.offsetX ?? v.offsetX) * (dw - box.w) * 0.5 : 0;
      const oy = useOffset ? (opts?.offsetY ?? v.offsetY) * (dh - box.h) * 0.5 : 0;
      const dx = box.x + (box.w - dw) / 2 + ox;
      const dy = box.y + (box.h - dh) / 2 + oy;
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      const extraBlur = style?.blur ? ` blur(${style.blur}px)` : "";
      ctx.filter = (baseFilter === "none" ? "" : baseFilter) + extraBlur || "none";
      ctx.translate(dx + dw / 2, dy + dh / 2);
      if (rect.quarter) ctx.rotate((rect.quarter * Math.PI) / 2);
      if (pre?.flipH) ctx.scale(-1, 1);
      if (pre?.flipV) ctx.scale(1, -1);
      const rw = rect.quarter % 2 ? dh : dw;
      const rh = rect.quarter % 2 ? dw : dh;
      ctx.drawImage(source.el, rect.sx, rect.sy, rect.sw, rect.sh, -rw / 2, -rh / 2, rw, rh);
      ctx.restore();
      if (style?.dim) {
        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${style.dim})`;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.restore();
      }
      return { dx, dy, dw, dh, mirror };
    };

    const quarter = cr.quarter;
    const full = {
      sx: 0,
      sy: 0,
      sw: source.width,
      sh: source.height,
      quarter,
      ew: quarter % 2 ? source.height : source.width,
      eh: quarter % 2 ? source.width : source.height,
    };
    const box = { x: v.x, y: v.y, w: v.w, h: v.h };

    /** Fundo dos layouts com preenchimento: desfoque do vídeo ou cor fixa. */
    const bgMode = pre?.bgMode ?? "blur";
    const bgIntensity = Math.max(0, pre?.bgBlur ?? 1);
    const paintBackdrop = (
      target: { x: number; y: number; w: number; h: number },
      baseBlur: number,
      dim: number,
    ) => {
      if (bgMode === "color") {
        ctx.save();
        ctx.fillStyle = pre?.bgColor || "#000000";
        ctx.fillRect(target.x, target.y, target.w, target.h);
        ctx.restore();
        return;
      }
      paint(target, "cover", full, {
        blur: Math.max(0, baseBlur * bgIntensity),
        dim: dim * Math.min(1, bgIntensity),
        useOffset: false,
      });
    };

    if (layout === "blur") {
      paintBackdrop(box, 34, 0.35);
      dest = paint(box, "contain");
    } else if (layout === "fit") {
      ctx.save();
      ctx.fillStyle = "#000";
      ctx.fillRect(v.x, v.y, v.w, v.h);
      ctx.restore();
      dest = paint(box, "contain");
    } else if (layout === "fill") {
      dest = paint(box, "cover");
    } else if (layout === "split") {
      const top = { x: v.x, y: v.y, w: v.w, h: v.h / 2 };
      const bottom = { x: v.x, y: v.y + v.h / 2, w: v.w, h: v.h / 2 };
      dest = paint(top, "cover");
      paint(bottom, "cover", full, { useOffset: false });
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(v.x, v.y + v.h / 2 - 1, v.w, 2);
      ctx.restore();
    } else if (layout === "trio") {
      const h = v.h / 3;
      const a = { x: v.x, y: v.y, w: v.w, h };
      const b = { x: v.x, y: v.y + h, w: v.w, h };
      const c = { x: v.x, y: v.y + h * 2, w: v.w, h };
      dest = paint(a, "cover");
      paint(b, "cover");
      paint(c, "cover", full, { useOffset: false });
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(v.x, v.y + h - 1, v.w, 2);
      ctx.fillRect(v.x, v.y + h * 2 - 1, v.w, 2);
      ctx.restore();
    } else if (layout === "spotlight") {
      const topH = v.h * 0.68;
      const top = { x: v.x, y: v.y, w: v.w, h: topH };
      const bottom = { x: v.x, y: v.y + topH, w: v.w, h: v.h - topH };
      paintBackdrop(box, 40, 0.45);
      dest = paint(top, "cover");
      paint(bottom, "contain", full, { useOffset: false });
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(v.x, v.y + topH - 1, v.w, 2);
      ctx.restore();
    } else if (layout === "centered") {
      paintBackdrop(box, 60, 0.55);
      dest = paint(box, "contain", full, { useOffset: false });
    } else if (layout === "horizontal") {
      ctx.save();
      ctx.fillStyle = t.background || "#000";
      ctx.fillRect(v.x, v.y, v.w, v.h);
      ctx.restore();
      dest = paint(box, "contain", full, { useOffset: false });
    } else {
      // "auto": só recorta quando a orientação bate com a do quadro; senão mostra inteiro
      const useContain =
        v.fit === "contain" ||
        ((v.fit === "auto" || manualCrop) && Math.abs(srcAR - boxAR) / boxAR > 0.02);
      dest = paint(box, useContain ? "contain" : "cover");
    }
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
  applyCleanup(ctx, v, t.cleanup, opts?.quality === "hq", {
    ...(opts?.time !== undefined ? { time: opts.time } : {}),
    ...(opts?.plate ? { plate: opts.plate } : {}),
    ...(dest ? { dest } : {}),
  });
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

/** o overlay está presente neste instante? (janelas detectadas) */
export function regionActiveAt(r: CleanupRegion, time?: number) {
  const ranges = r.timeRanges;
  if (!ranges?.length || time === undefined) return true;
  return ranges.some((t) => time >= t.start && time <= t.end);
}

/** Remove legenda queimada / marca d'água / texto do vídeo original dentro das máscaras. */
export function applyCleanup(
  ctx: CanvasRenderingContext2D,
  v: { x: number; y: number; w: number; h: number; radius: number },
  regions?: CleanupRegion[],
  hq = false,
  extra?: {
    time?: number;
    plate?: { canvas: HTMLCanvasElement; ok: Set<string> } | null;
    dest?: { dx: number; dy: number; dw: number; dh: number; mirror: boolean };
  },
) {
  const list = (regions ?? []).filter(
    (r) => r.enabled && r.w > 0 && r.h > 0 && regionActiveAt(r, extra?.time),
  );
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

    // 1ª opção: fundo real recuperado por mediana temporal (pixels do próprio vídeo)
    const plate = extra?.plate;
    const dest = extra?.dest;
    if (r.mode === "inpaint" && plate && dest && plate.ok.has(r.id)) {
      ctx.save();
      if (dest.mirror) {
        ctx.translate(v.x * 2 + v.w, 0);
        ctx.scale(-1, 1);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(plate.canvas, dest.dx, dest.dy, dest.dw, dest.dh);
      ctx.restore();
      ctx.restore();
      continue;
    }



    if (r.mode === "inpaint") {
      inpaintArea(ctx, x, y, w, h);
    } else if (r.mode === "solid") {
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

  // transição de abertura/saída: afeta o quadro montado inteiro
  const tr = transitionAt(opts?.pre, opts?.time, opts?.clip ?? null);
  const animating = tr.alpha < 1 || tr.scale !== 1 || tr.dx !== 0 || tr.dy !== 0;
  if (animating) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, tr.alpha));
    ctx.translate(W / 2 + tr.dx * W, H / 2 + tr.dy * H);
    ctx.scale(tr.scale, tr.scale);
    ctx.translate(-W / 2, -H / 2);
  }

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
  if (animating) ctx.restore();
  ctx.restore();
}
