import { defaultAntiDup, type AntiDupConfig } from "./variation";

export type LayerId =
  | "video"
  | "watermark"
  | "avatar"
  | "name"
  | "handle"
  | "headline"
  | "cta"
  | "captions";

/** Identificador de camada selecionável: fixa ou extra ("extra:<id>"). */
export type SelId = LayerId | string;

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

export interface BoxLayer {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  rotation: number;
  /** ordem de empilhamento (maior = na frente) */
  z?: number;
  /** opacidade 0..1 (padrão 1) */
  opacity?: number;
}

export interface TextLayer extends BoxLayer {
  text: string;
  color: string;
  size: number;
  weight: "400" | "600" | "700" | "800";
  align: "left" | "center" | "right";
  font: string;
  accentFrom?: number;
  accentTo?: number;
  accentColor?: string;
  badge?: boolean;
}

export interface ImageLayer extends BoxLayer {
  src: string | null;
  opacity: number;
  round: boolean;
}

export interface VideoLayer extends BoxLayer {
  radius: number;
  offsetX: number;
  offsetY: number;
  /** "cover" recorta pra preencher · "contain" mostra inteiro · "auto" decide pela orientação da fonte. */
  fit?: "cover" | "contain" | "auto";
}

export type ExtraLayer = (TextLayer | ImageLayer) & { id: string; label: string };

/** Estilo das legendas automáticas. */
export interface CaptionStyle extends BoxLayer {
  size: number;
  font: string;
  weight: "400" | "600" | "700" | "800";
  color: string;
  activeColor: string;
  strokeColor: string;
  stroke: number;
  bg: "none" | "box" | "shadow";
  boxColor: string;
  uppercase: boolean;
  /** karaoke = destaca a palavra atual · word = uma palavra por vez · line = linha inteira */
  mode: "karaoke" | "word" | "line";
  maxWords: number;
  align: "left" | "center" | "right";
  /** animação de entrada de cada bloco/palavra */
  anim?: "none" | "pop" | "bounce" | "slide" | "fade" | "typewriter";
  /** como a palavra falada é destacada */
  highlight?: "color" | "box" | "underline" | "scale";
  /** cor da caixa/sublinhado do destaque */
  highlightColor?: string;
  /** máximo de linhas exibidas ao mesmo tempo */
  maxLines?: number;
  /** espaçamento entre linhas (multiplicador) */
  lineHeight?: number;
  /** respiro interno da caixa de fundo (multiplicador do tamanho da fonte) */
  boxPad?: number;
  /** arredondamento da caixa de fundo (multiplicador do tamanho da fonte) */
  boxRadius?: number;
  /** opacidade da caixa de fundo (0–1) */
  boxOpacity?: number;
}


/** Presets prontos, estilo CapCut. */
export const CAPTION_PRESETS: { id: string; label: string; style: Partial<CaptionStyle> }[] = [
  {
    id: "capcut",
    label: "CapCut Clássico",
    style: {
      font: "Arial Black, sans-serif", weight: "800", color: "#ffffff", activeColor: "#ffe600",
      stroke: 12, strokeColor: "#000000", bg: "shadow", uppercase: true, mode: "karaoke",
      anim: "pop", highlight: "color", maxWords: 4, maxLines: 2, size: 68,
    },
  },
  {
    id: "neon",
    label: "Neon Viral",
    style: {
      font: "Inter, sans-serif", weight: "800", color: "#ffffff", activeColor: "#c6f24e",
      stroke: 8, strokeColor: "#0a0a0a", bg: "shadow", uppercase: true, mode: "karaoke",
      anim: "bounce", highlight: "scale", maxWords: 3, maxLines: 2, size: 72,
    },
  },
  {
    id: "box",
    label: "Caixa Destaque",
    style: {
      font: "Inter, sans-serif", weight: "700", color: "#ffffff", activeColor: "#111111",
      stroke: 0, bg: "none", uppercase: false, mode: "karaoke", anim: "fade",
      highlight: "box", highlightColor: "#c6f24e", maxWords: 5, maxLines: 2, size: 60,
    },
  },
  {
    id: "oneword",
    label: "Uma Palavra",
    style: {
      font: "Impact, sans-serif", weight: "800", color: "#ffffff", activeColor: "#ff3b3b",
      stroke: 14, strokeColor: "#000000", bg: "none", uppercase: true, mode: "word",
      anim: "pop", highlight: "color", maxWords: 1, maxLines: 1, size: 110,
    },
  },
  {
    id: "clean",
    label: "Minimal Clean",
    style: {
      font: "Inter, sans-serif", weight: "600", color: "#ffffff", activeColor: "#ffffff",
      stroke: 0, bg: "box", boxColor: "#000000", uppercase: false, mode: "line",
      anim: "slide", highlight: "color", maxWords: 6, maxLines: 2, size: 52,
    },
  },
  {
    id: "type",
    label: "Máquina de Escrever",
    style: {
      font: "Courier New, monospace", weight: "700", color: "#ffffff", activeColor: "#c6f24e",
      stroke: 6, strokeColor: "#000000", bg: "shadow", uppercase: false, mode: "karaoke",
      anim: "typewriter", highlight: "underline", highlightColor: "#c6f24e",
      maxWords: 5, maxLines: 2, size: 56,
    },
  },
  {
    id: "typemono",
    label: "Máquina Terminal",
    style: {
      font: "Courier New, monospace", weight: "700", color: "#c6f24e", activeColor: "#ffffff",
      stroke: 0, bg: "box", boxColor: "#000000", uppercase: true, mode: "line",
      anim: "typewriter", highlight: "color", maxWords: 6, maxLines: 2, size: 48,
    },
  },
  {
    id: "popcandy",
    label: "Pop Candy",
    style: {
      font: "Arial Black, sans-serif", weight: "800", color: "#ffffff", activeColor: "#ff4fd8",
      stroke: 14, strokeColor: "#1a0033", bg: "shadow", uppercase: true, mode: "karaoke",
      anim: "pop", highlight: "scale", maxWords: 3, maxLines: 2, size: 78,
    },
  },
  {
    id: "slideup",
    label: "Slide Cinema",
    style: {
      font: "Inter, sans-serif", weight: "700", color: "#f5f5f5", activeColor: "#ffcc00",
      stroke: 4, strokeColor: "#000000", bg: "shadow", uppercase: false, mode: "line",
      anim: "slide", highlight: "underline", highlightColor: "#ffcc00",
      maxWords: 7, maxLines: 2, size: 50,
    },
  },
  {
    id: "wordbox",
    label: "Highlight por Palavra",
    style: {
      font: "Arial Black, sans-serif", weight: "800", color: "#ffffff", activeColor: "#000000",
      stroke: 8, strokeColor: "#000000", bg: "none", uppercase: true, mode: "karaoke",
      anim: "pop", highlight: "box", highlightColor: "#00e5ff", maxWords: 4, maxLines: 2, size: 66,
    },
  },
  {
    id: "hormozi",
    label: "Impacto Amarelo",
    style: {
      font: "Impact, sans-serif", weight: "800", color: "#ffffff", activeColor: "#ffd400",
      stroke: 16, strokeColor: "#000000", bg: "shadow", uppercase: true, mode: "karaoke",
      anim: "bounce", highlight: "scale", maxWords: 3, maxLines: 2, size: 84,
    },
  },
];


export interface CustomFont {
  name: string;
  dataUrl: string;
}

/** Máscara para remover legenda queimada, marca d'água ou texto do vídeo original.
 *  Coordenadas normalizadas (0..1) relativas à área do vídeo. */
export interface CleanupRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** inpaint = reconstrução IA (Telea/FMM, sem borrão), smear = clonar vizinho, blur/pixelate/solid = tarjas */
  mode: "inpaint" | "blur" | "pixelate" | "solid" | "smear";
  /** 1..100 */
  strength: number;
  color?: string;
  /** direção de onde copiar os pixels no modo smear */
  from?: "bottom" | "top" | "left" | "right";
  /** trechos (s) em que o overlay aparece; vazio/ausente = o vídeo inteiro */
  timeRanges?: { start: number; end: number }[];
  /** como reconstruir: median = fundo real de outros quadros, inpaint = reconstrução IA */
  recover?: "median" | "inpaint";
  enabled: boolean;
}


export function makeCleanupRegion(p: Partial<CleanupRegion> = {}): CleanupRegion {
  return {
    id: crypto.randomUUID(),
    label: "Área",
    x: 0.1,
    y: 0.78,
    w: 0.8,
    h: 0.12,
    mode: "inpaint",
    strength: 60,
    color: "#000000",
    from: "top",
    enabled: true,
    ...p,
  };
}

/** Presets de posições comuns de legenda/marca d'água nas redes. */
export const CLEANUP_PRESETS: { id: string; label: string; region: Partial<CleanupRegion> }[] = [
  {
    id: "cap-bottom",
    label: "Legenda embaixo",
    region: { label: "Legenda embaixo", x: 0.05, y: 0.74, w: 0.9, h: 0.14, mode: "inpaint", from: "top" },
  },
  {
    id: "cap-center",
    label: "Legenda no meio",
    region: { label: "Legenda no meio", x: 0.05, y: 0.44, w: 0.9, h: 0.14, mode: "inpaint", strength: 60 },
  },
  {
    id: "tt-wm",
    label: "Marca d'água TikTok",
    region: { label: "Marca d'água TikTok", x: 0.62, y: 0.08, w: 0.34, h: 0.09, mode: "inpaint", from: "left" },
  },
  {
    id: "tt-user",
    label: "@usuário TikTok",
    region: { label: "@usuário TikTok", x: 0.04, y: 0.86, w: 0.6, h: 0.07, mode: "inpaint", from: "top" },
  },
  {
    id: "top-text",
    label: "Texto no topo",
    region: { label: "Texto no topo", x: 0.05, y: 0.06, w: 0.9, h: 0.14, mode: "inpaint", from: "bottom" },
  },
  {
    id: "corner-logo",
    label: "Logo canto superior",
    region: { label: "Logo canto", x: 0.03, y: 0.03, w: 0.24, h: 0.1, mode: "pixelate", strength: 60 },
  },
];


export interface Template {
  id: string;
  name: string;
  version?: number;
  updatedAt?: number;
  canvasW?: number;
  canvasH?: number;
  background: string;
  video: VideoLayer;
  watermark: ImageLayer;
  avatar: ImageLayer;
  name_: TextLayer;
  handle: TextLayer;
  headline: TextLayer;
  cta: TextLayer;
  captions?: CaptionStyle;
  extras?: ExtraLayer[];
  fonts?: CustomFont[];
  mirror: boolean;
  speed: number;
  antiDup?: AntiDupConfig;
  /** máscaras de remoção de legenda/marca d'água/texto do vídeo original */
  cleanup?: CleanupRegion[];

}

const text = (o: Partial<TextLayer>): TextLayer => ({
  x: 90,
  y: 100,
  w: 900,
  h: 90,
  visible: true,
  rotation: 0,
  text: "",
  color: "#ffffff",
  size: 52,
  weight: "700",
  align: "left",
  font: "Inter, sans-serif",
  ...o,
});

export function defaultCaptions(): CaptionStyle {
  return {
    x: 90,
    y: 1420,
    w: 900,
    h: 220,
    visible: false,
    rotation: 0,
    z: 70,
    opacity: 1,
    size: 64,
    font: "Inter, sans-serif",
    weight: "800",
    color: "#ffffff",
    activeColor: "#c6f24e",
    strokeColor: "#000000",
    stroke: 10,
    bg: "shadow",
    boxColor: "#000000",
    uppercase: true,
    mode: "karaoke",
    maxWords: 4,
    align: "center",
    anim: "pop",
    highlight: "color",
    highlightColor: "#c6f24e",
    maxLines: 2,
    lineHeight: 1.2,
  };

}

export function createTemplate(name = "Novo template"): Template {
  return {
    id: crypto.randomUUID(),
    name,
    version: 1,
    updatedAt: Date.now(),
    background: "#0a0a0a",
    video: {
      x: 60,
      y: 620,
      w: 960,
      h: 1080,
      visible: true,
      rotation: 0,
      radius: 24,
      offsetX: 0,
      offsetY: 0,
      z: 0,
    },
    watermark: {
      x: 720,
      y: 1500,
      w: 260,
      h: 260,
      visible: false,
      rotation: 0,
      src: null,
      opacity: 0.35,
      round: false,
      z: 10,
    },
    avatar: {
      x: 90,
      y: 250,
      w: 140,
      h: 140,
      visible: true,
      rotation: 0,
      src: null,
      opacity: 1,
      round: true,
      z: 20,
    },
    name_: text({ x: 260, y: 258, text: "Seu nome", size: 56, badge: true, z: 30 }),
    handle: text({
      x: 260,
      y: 325,
      text: "@seuusuario",
      size: 38,
      weight: "400",
      color: "#9aa0a6",
      h: 60,
      z: 40,
    }),
    headline: text({
      x: 90,
      y: 430,
      w: 900,
      h: 160,
      text: "Digite aqui sua headline",
      size: 60,
      weight: "800",
      align: "center",
      z: 50,
    }),
    cta: text({
      x: 90,
      y: 1760,
      w: 900,
      h: 70,
      text: "Clique em seguir",
      size: 40,
      weight: "600",
      align: "center",
      color: "#c9cdd2",
      z: 60,
    }),
    captions: defaultCaptions(),
    extras: [],
    fonts: [],
    mirror: false,
    speed: 1,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    antiDup: defaultAntiDup(),
    cleanup: [],

  };
}

/** Cria uma camada livre de texto ou imagem. */
export function makeExtra(kind: "text" | "image", index: number): ExtraLayer {
  const base = {
    id: crypto.randomUUID(),
    x: 140,
    y: 900,
    visible: true,
    rotation: 0,
    z: 100 + index,
    opacity: 1,
  };
  if (kind === "text") {
    return {
      ...base,
      label: `Texto ${index + 1}`,
      w: 800,
      h: 120,
      text: "Novo texto",
      color: "#ffffff",
      size: 56,
      weight: "700",
      align: "center",
      font: "Inter, sans-serif",
    } as ExtraLayer;
  }
  return {
    ...base,
    label: `Imagem ${index + 1}`,
    w: 300,
    h: 300,
    src: null,
    round: false,
  } as ExtraLayer;
}

export const RATIO_PRESETS = [
  { id: "9:16", label: "9:16 · Reels/TikTok/Shorts", w: 1080, h: 1920 },
  { id: "4:5", label: "4:5 · Feed vertical", w: 1080, h: 1350 },
  { id: "1:1", label: "1:1 · Quadrado", w: 1080, h: 1080 },
] as const;

/** Presets de entrega por plataforma (MP4 H.264). */
export interface PlatformPreset {
  id: string;
  label: string;
  short: string;
  w: number;
  h: number;
  fps: number;
  /** bitrate de vídeo em Mbps */
  bitrate: number;
  /** duração máxima recomendada, em segundos */
  maxDur: number;
  hint: string;
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: "reels",
    label: "Instagram Reels",
    short: "reels",
    w: 1080,
    h: 1920,
    fps: 30,
    bitrate: 12,
    maxDur: 90,
    hint: "1080×1920 · 30fps · H.264 · até 90s",
  },
  {
    id: "tiktok",
    label: "TikTok",
    short: "tiktok",
    w: 1080,
    h: 1920,
    fps: 30,
    bitrate: 10,
    maxDur: 180,
    hint: "1080×1920 · 30fps · H.264 · até 3min",
  },
  {
    id: "shorts",
    label: "YouTube Shorts",
    short: "shorts",
    w: 1080,
    h: 1920,
    fps: 60,
    bitrate: 16,
    maxDur: 180,
    hint: "1080×1920 · 60fps · H.264 · até 3min",
  },
  {
    id: "feed",
    label: "Feed 4:5",
    short: "feed",
    w: 1080,
    h: 1350,
    fps: 30,
    bitrate: 10,
    maxDur: 90,
    hint: "1080×1350 · 30fps · H.264",
  },
];


/** Orientação da fonte, com tolerância pra vídeos quase quadrados. */
export function orientationOf(w: number, h: number): "vertical" | "horizontal" | "square" {
  if (!w || !h) return "vertical";
  const r = w / h;
  if (r > 1.05) return "horizontal";
  if (r < 0.95) return "vertical";
  return "square";
}

/** Ajusta o canvas à proporção real da fonte (sem zoom nem recorte) e põe o vídeo inteiro nele. */
export function fitCanvasToSource(t: Template, srcW: number, srcH: number, maxDim = 1080): Template {
  if (!srcW || !srcH) return t;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = even(srcW * scale);
  const h = even(srcH * scale);
  const scaled = applyRatio(t, w, h);
  return {
    ...scaled,
    canvasW: w,
    canvasH: h,
    video: {
      ...scaled.video,
      x: 0,
      y: 0,
      w,
      h,
      rotation: 0,
      radius: 0,
      offsetX: 0,
      offsetY: 0,
      fit: "contain",
      visible: true,
    },
  };
}

/** Troca a proporção reescalando todas as camadas proporcionalmente. */
export function applyRatio(t: Template, w: number, h: number): Template {
  const fx = w / (t.canvasW ?? CANVAS_W);
  const fy = h / (t.canvasH ?? CANVAS_H);
  const box = <T extends BoxLayer>(l: T): T => ({
    ...l,
    x: Math.round(l.x * fx),
    y: Math.round(l.y * fy),
    w: Math.round(l.w * fx),
    h: Math.round(l.h * fy),
    ...("size" in l ? { size: Math.round((l as unknown as TextLayer).size * fx) } : {}),
  });
  return {
    ...t,
    canvasW: w,
    canvasH: h,
    video: box(t.video),
    watermark: box(t.watermark),
    avatar: box(t.avatar),
    name_: box(t.name_),
    handle: box(t.handle),
    headline: box(t.headline),
    cta: box(t.cta),
    ...(t.captions ? { captions: box(t.captions) } : {}),
    extras: (t.extras ?? []).map(box),
  };
}

export const LAYER_LABELS: Record<LayerId, string> = {
  video: "Vídeo",
  watermark: "Marca d'água",
  avatar: "Foto (avatar)",
  name: "Nome do perfil",
  handle: "@ Nome de usuário",
  headline: "Headline",
  cta: "CTA (chamada)",
  captions: "Legendas automáticas",
};

const KEY = "vv.templates";
const VKEY = "vv.template-versions";
const MAX_VERSIONS = 8;

export interface TemplateVersion {
  version: number;
  savedAt: number;
  note: string;
  snapshot: Template;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Garante campos novos em templates salvos antes desta versão. */
export function migrate(t: Template): Template {
  return {
    ...t,
    captions: t.captions ?? defaultCaptions(),
    extras: t.extras ?? [],
    fonts: t.fonts ?? [],
    antiDup: { ...defaultAntiDup(), ...(t.antiDup ?? {}) },
  };
}

export function loadTemplates(): Template[] {
  return read<Template[]>(KEY, []).map(migrate);
}

/** Escrita tolerante a quota: nunca lança, apenas avisa no console. */
function safeWrite(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function saveTemplates(list: Template[]) {
  if (typeof window === "undefined") return;
  if (!safeWrite(KEY, JSON.stringify(list))) {
    // libera espaço descartando o histórico de versões e tenta de novo
    try {
      localStorage.removeItem(VKEY);
    } catch {
      /* ignora */
    }
    if (!safeWrite(KEY, JSON.stringify(list))) {
      console.warn("Armazenamento local cheio: não foi possível salvar os templates.");
    }
  }
}

type VersionMap = Record<string, TemplateVersion[]>;

export function loadVersions(templateId: string): TemplateVersion[] {
  return read<VersionMap>(VKEY, {})[templateId] ?? [];
}

/** Grava o histórico podando versões antigas até caber na quota. */
function writeVersions(map: VersionMap) {
  if (typeof window === "undefined") return;
  let current = map;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (safeWrite(VKEY, JSON.stringify(current))) return;
    // descarta a versão mais antiga da lista mais longa
    let longestId = "";
    let longest = 0;
    for (const [id, versions] of Object.entries(current)) {
      if (versions.length > longest) {
        longest = versions.length;
        longestId = id;
      }
    }
    if (!longestId || longest <= 1) break;
    current = { ...current, [longestId]: current[longestId].slice(0, longest - 1) };
  }
  try {
    localStorage.removeItem(VKEY);
  } catch {
    /* ignora */
  }
}

/** Salva o template criando uma nova versão no histórico. */
export function commitTemplate(
  list: Template[],
  template: Template,
  note = "",
): { list: Template[]; template: Template } {
  const map = read<VersionMap>(VKEY, {});
  const history = map[template.id] ?? [];
  const nextVersion = (history[0]?.version ?? template.version ?? 0) + 1;
  const saved: Template = { ...template, version: nextVersion, updatedAt: Date.now() };

  map[template.id] = [
    { version: nextVersion, savedAt: saved.updatedAt!, note, snapshot: saved },
    ...history,
  ].slice(0, MAX_VERSIONS);
  writeVersions(map);

  const nextList = list.some((t) => t.id === saved.id)
    ? list.map((t) => (t.id === saved.id ? saved : t))
    : [...list, saved];
  saveTemplates(nextList);
  return { list: nextList, template: saved };
}

export function deleteTemplate(list: Template[], id: string): Template[] {
  const next = list.filter((t) => t.id !== id);
  saveTemplates(next);
  const map = read<VersionMap>(VKEY, {});
  delete map[id];
  writeVersions(map);
  return next;
}

export function duplicateTemplate(template: Template, name?: string): Template {
  return {
    ...structuredClone(template),
    id: crypto.randomUUID(),
    name: name ?? `${template.name} (cópia)`,
    version: 1,
    updatedAt: Date.now(),
  };
}

export function exportTemplate(template: Template) {
  const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${template.name.replace(/\s+/g, "-").toLowerCase()}.vaiviral.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function importTemplateFile(file: File): Promise<Template> {
  const parsed = JSON.parse(await file.text()) as Partial<Template>;
  if (!parsed || !parsed.video || !parsed.headline) throw new Error("Arquivo de template inválido");
  const base = createTemplate(parsed.name ?? "Template importado");
  return migrate({ ...base, ...parsed, id: base.id, version: 1, updatedAt: Date.now() } as Template);
}
