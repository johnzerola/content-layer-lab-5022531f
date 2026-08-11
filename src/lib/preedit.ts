/** Pré-edição do vídeo de origem: corte de tempo, recorte (crop), cor e giro.
 *  Aplicada ANTES do template — vale para preview e exportação. */

export interface PreCrop {
  /** todos normalizados 0..1 relativos ao vídeo original */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TransitionKind = "none" | "fade" | "zoom" | "slide-up" | "slide-left" | "whip";

export interface Transition {
  kind: TransitionKind;
  /** duração em segundos */
  dur: number;
}

/** Keyframe de enquadramento: em `t` segundos o recorte fica assim. */
export interface FrameKey {
  t: number;
  crop: PreCrop;
}

/** Layout do clipe vertical (estilo Clipzi). */
export type LayoutKind =
  | "auto"
  | "fill"
  | "fit"
  | "blur"
  | "split"
  | "trio"
  | "spotlight"
  | "centered"
  | "horizontal";

/** Trecho mantido do vídeo original (corte multi-segmento). */
export interface Segment {
  start: number;
  end: number;
}

export interface PreEdit {
  /** recorte de área do vídeo original (null = quadro inteiro) */
  crop: PreCrop | null;
  /** keyframes de enquadramento (vazio = recorte fixo acima) */
  keys: FrameKey[];
  /** trechos mantidos (vazio = usa a janela de corte simples) */
  segments: Segment[];
  /** layout do quadro final */
  layout: LayoutKind;
  /** fundo dos layouts com preenchimento: desfoque do próprio vídeo ou cor fixa */
  bgMode: "blur" | "color";
  /** intensidade do desfoque do fundo (0..2, 1 = padrão) */
  bgBlur: number;
  /** cor usada quando bgMode = "color" */
  bgColor: string;
  /** transição de abertura */
  transIn: Transition;
  /** transição de saída */
  transOut: Transition;
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
    keys: [],
    segments: [],
    layout: "auto",
    bgMode: "blur",
    bgBlur: 1,
    bgColor: "#000000",
    transIn: { kind: "none", dur: 0.5 },
    transOut: { kind: "none", dur: 0.5 },
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

export const LAYOUTS: { id: LayoutKind; label: string; hint: string }[] = [
  { id: "auto", label: "Automático", hint: "Preenche quando a orientação bate, senão mostra inteiro" },
  { id: "fill", label: "Tela cheia", hint: "Preenche todo o quadro (corta as bordas)" },
  { id: "fit", label: "Inteiro", hint: "Vídeo completo com barras pretas" },
  { id: "blur", label: "Fundo desfocado", hint: "Vídeo inteiro sobre o próprio quadro desfocado" },
  { id: "split", label: "Dividido", hint: "Recorte em cima, quadro completo embaixo" },
  { id: "trio", label: "Trio", hint: "Três faixas: recorte, destaque com zoom e quadro completo" },
  { id: "spotlight", label: "Destaque", hint: "Recorte grande em cima e o quadro inteiro embaixo" },
  { id: "centered", label: "Centralizado", hint: "Quadro completo no centro com fundo suave" },
  { id: "horizontal", label: "Horizontal", hint: "Vídeo original centralizado, sem cortes" },
];

/** Trechos válidos: usa os segmentos quando existirem, senão a janela de corte. */
export function keptSegments(
  p: PreEdit | null | undefined,
  clip?: { start: number; end: number } | null,
  duration?: number,
): Segment[] {
  const lo = clip?.start ?? 0;
  const hi = clip?.end ?? duration ?? Infinity;
  const segs = (p?.segments ?? [])
    .map((s) => ({ start: Math.max(lo, s.start), end: Math.min(hi, s.end) }))
    .filter((s) => s.end - s.start > 0.05)
    .sort((a, b) => a.start - b.start);
  if (segs.length) return segs;
  return Number.isFinite(hi) ? [{ start: lo, end: hi }] : [];
}

/** Duração total dos trechos mantidos. */
export function segmentsDuration(segs: Segment[]) {
  return segs.reduce((acc, s) => acc + Math.max(0, s.end - s.start), 0);
}

/** Converte o tempo da saída (0..total) para o tempo do vídeo original. */
export function srcTimeAt(segs: Segment[], out: number) {
  let left = Math.max(0, out);
  for (const s of segs) {
    const len = Math.max(0, s.end - s.start);
    if (left < len) return s.start + left;
    left -= len;
  }
  const last = segs[segs.length - 1];
  return last ? last.end : out;
}

/** Divide o trecho que contém `t` em dois (corte de tesoura). */
export function splitAt(segs: Segment[], t: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (t > s.start + 0.12 && t < s.end - 0.12) {
      out.push({ start: s.start, end: t }, { start: t, end: s.end });
    } else out.push(s);
  }
  return out;
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
    (p.keys?.length ?? 0) > 0 ||
    (p.segments?.length ?? 0) > 1 ||
    (p.layout ?? "auto") !== "auto" ||
    (p.bgMode ?? "blur") !== "blur" ||
    (p.bgBlur ?? 1) !== 1 ||
    (p.transIn?.kind ?? "none") !== "none" ||

    (p.transOut?.kind ?? "none") !== "none" ||
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

/** Recorte válido no instante `t` (interpolando os keyframes, quando houver). */
export function cropAt(p: PreEdit | null | undefined, t?: number): PreCrop | null {
  const keys = p?.keys;
  if (!keys || keys.length === 0 || t === undefined) return p?.crop ?? null;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (t <= sorted[0]!.t) return sorted[0]!.crop;
  const last = sorted[sorted.length - 1]!;
  if (t >= last.t) return last.crop;
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1]!.t < t) i++;
  const a = sorted[i]!;
  const b = sorted[i + 1]!;
  const span = Math.max(1e-4, b.t - a.t);
  const raw = (t - a.t) / span;
  // suavização (ease-in-out) para um movimento de câmera natural
  const k = raw * raw * (3 - 2 * raw);
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    x: mix(a.crop.x, b.crop.x),
    y: mix(a.crop.y, b.crop.y),
    w: mix(a.crop.w, b.crop.w),
    h: mix(a.crop.h, b.crop.h),
  };
}

/** Estado da transição de abertura/saída no instante `t` do trecho exportado. */
export function transitionAt(
  p: PreEdit | null | undefined,
  t?: number,
  clip?: { start: number; end: number } | null,
): { alpha: number; scale: number; dx: number; dy: number } {
  const none = { alpha: 1, scale: 1, dx: 0, dy: 0 };
  if (!p || t === undefined) return none;
  const start = clip?.start ?? 0;
  const end = clip?.end;
  const local = t - start;
  const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

  const apply = (kind: TransitionKind, k: number, outward: boolean) => {
    const e = easeOut(Math.min(1, Math.max(0, k)));
    const dir = outward ? -1 : 1;
    switch (kind) {
      case "fade":
        return { alpha: e, scale: 1, dx: 0, dy: 0 };
      case "zoom":
        return { alpha: e, scale: 1 + (1 - e) * 0.18, dx: 0, dy: 0 };
      case "slide-up":
        return { alpha: e, scale: 1, dx: 0, dy: dir * (1 - e) * 0.25 };
      case "slide-left":
        return { alpha: e, scale: 1, dx: dir * (1 - e) * 0.25, dy: 0 };
      case "whip":
        return { alpha: e, scale: 1 + (1 - e) * 0.06, dx: dir * (1 - e) * 0.4, dy: 0 };
      default:
        return none;
    }
  };

  const tin = p.transIn;
  if (tin && tin.kind !== "none" && tin.dur > 0 && local < tin.dur) {
    return apply(tin.kind, local / tin.dur, false);
  }
  const tout = p.transOut;
  if (tout && tout.kind !== "none" && tout.dur > 0 && end !== undefined) {
    const left = end - t;
    if (left < tout.dur) return apply(tout.kind, Math.max(0, left) / tout.dur, true);
  }
  return none;
}

/** Retângulo em pixels da fonte + dimensões efetivas após o giro. */
export function cropRect(p: PreEdit | null | undefined, w: number, h: number, time?: number) {
  const anim = cropAt(p, time);
  const c = anim && !isFullCrop(anim) ? anim : FULL;
  const sx = Math.max(0, Math.round(c.x * w));
  const sy = Math.max(0, Math.round(c.y * h));
  const sw = Math.max(2, Math.min(w - sx, Math.round(c.w * w)));
  const sh = Math.max(2, Math.min(h - sy, Math.round(c.h * h)));
  const quarter = (((p?.rotate ?? 0) / 90) | 0) % 4;
  return { sx, sy, sw, sh, quarter, ew: quarter % 2 ? sh : sw, eh: quarter % 2 ? sw : sh };
}

export const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: "none", label: "Nenhuma" },
  { id: "fade", label: "Fade" },
  { id: "zoom", label: "Zoom" },
  { id: "slide-up", label: "Subir" },
  { id: "slide-left", label: "Deslizar" },
  { id: "whip", label: "Whip" },
];

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
