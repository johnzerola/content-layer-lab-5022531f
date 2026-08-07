/** Pré-edição do vídeo de origem: corte de tempo, recorte (crop), cor e giro.
 *  Aplicada ANTES do template — vale para preview e exportação. */

export interface PreCrop {
  /** todos normalizados 0..1 relativos ao vídeo original */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PreEdit {
  /** recorte de área do vídeo original (null = quadro inteiro) */
  crop: PreCrop | null;
  /** giro em passos de 90° */
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  /** graus (-180..180) */
  hue: number;
  /** 0..1 */
  sepia: number;
  /** 0..1 */
  grayscale: number;
  /** px */
  blur: number;
}

export function defaultPreEdit(): PreEdit {
  return {
    crop: null,
    rotate: 0,
    flipH: false,
    flipV: false,
    brightness: 1,
    contrast: 1,
    saturation: 1,
    hue: 0,
    sepia: 0,
    grayscale: 0,
    blur: 0,
  };
}

const FULL: PreCrop = { x: 0, y: 0, w: 1, h: 1 };

export function isFullCrop(c: PreCrop | null | undefined) {
  if (!c) return true;
  return (
    Math.abs(c.x - FULL.x) < 0.002 &&
    Math.abs(c.y - FULL.y) < 0.002 &&
    Math.abs(c.w - FULL.w) < 0.002 &&
    Math.abs(c.h - FULL.h) < 0.002
  );
}

/** true quando a pré-edição muda alguma coisa (evita trabalho à toa). */
export function hasPreEdit(p?: PreEdit | null) {
  if (!p) return false;
  return (
    !isFullCrop(p.crop) ||
    p.rotate !== 0 ||
    p.flipH ||
    p.flipV ||
    p.brightness !== 1 ||
    p.contrast !== 1 ||
    p.saturation !== 1 ||
    p.hue !== 0 ||
    p.sepia > 0 ||
    p.grayscale > 0 ||
    p.blur > 0
  );
}

/** Filtro CSS/canvas combinando a pré-edição com o ajuste anti-duplicidade. */
export function preEditFilter(p?: PreEdit | null, extra?: { brightness?: number; saturation?: number }) {
  const b = (p?.brightness ?? 1) * (extra?.brightness ?? 1);
  const s = (p?.saturation ?? 1) * (extra?.saturation ?? 1);
  const parts: string[] = [];
  if (b !== 1) parts.push(`brightness(${b.toFixed(3)})`);
  if (s !== 1) parts.push(`saturate(${s.toFixed(3)})`);
  if (p && p.contrast !== 1) parts.push(`contrast(${p.contrast.toFixed(3)})`);
  if (p && p.hue) parts.push(`hue-rotate(${Math.round(p.hue)}deg)`);
  if (p && p.sepia > 0) parts.push(`sepia(${p.sepia.toFixed(2)})`);
  if (p && p.grayscale > 0) parts.push(`grayscale(${p.grayscale.toFixed(2)})`);
  if (p && p.blur > 0) parts.push(`blur(${p.blur.toFixed(1)}px)`);
  return parts.length ? parts.join(" ") : "none";
}

/** Retângulo em pixels da fonte + dimensões efetivas após o giro. */
export function cropRect(p: PreEdit | null | undefined, w: number, h: number) {
  const c = p?.crop && !isFullCrop(p.crop) ? p.crop : FULL;
  const sx = Math.max(0, Math.round(c.x * w));
  const sy = Math.max(0, Math.round(c.y * h));
  const sw = Math.max(2, Math.min(w - sx, Math.round(c.w * w)));
  const sh = Math.max(2, Math.min(h - sy, Math.round(c.h * h)));
  const quarter = (((p?.rotate ?? 0) / 90) | 0) % 4;
  return { sx, sy, sw, sh, quarter, ew: quarter % 2 ? sh : sw, eh: quarter % 2 ? sw : sh };
}

export const CROP_PRESETS: { id: string; label: string; ratio: number | null }[] = [
  { id: "free", label: "Livre", ratio: null },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
];

export const COLOR_PRESETS: { id: string; label: string; v: Partial<PreEdit> }[] = [
  { id: "none", label: "Original", v: { brightness: 1, contrast: 1, saturation: 1, hue: 0, sepia: 0, grayscale: 0 } },
  { id: "punch", label: "Punch", v: { brightness: 1.06, contrast: 1.18, saturation: 1.3, hue: 0, sepia: 0, grayscale: 0 } },
  { id: "warm", label: "Quente", v: { brightness: 1.04, contrast: 1.06, saturation: 1.15, hue: -8, sepia: 0.15, grayscale: 0 } },
  { id: "cold", label: "Frio", v: { brightness: 1, contrast: 1.1, saturation: 1.05, hue: 12, sepia: 0, grayscale: 0 } },
  { id: "film", label: "Cinema", v: { brightness: 0.96, contrast: 1.22, saturation: 0.9, hue: 4, sepia: 0.12, grayscale: 0 } },
  { id: "bw", label: "P&B", v: { brightness: 1.02, contrast: 1.15, saturation: 1, hue: 0, sepia: 0, grayscale: 1 } },
];

/** Centraliza um recorte com a proporção pedida dentro do vídeo. */
export function cropForRatio(ratio: number, srcW: number, srcH: number): PreCrop {
  const srcAR = srcW / srcH;
  if (ratio > srcAR) {
    const h = srcAR / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio / srcAR;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}
