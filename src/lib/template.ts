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
}

export interface CustomFont {
  name: string;
  dataUrl: string;
}

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
const MAX_VERSIONS = 20;

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

export function saveTemplates(list: Template[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

type VersionMap = Record<string, TemplateVersion[]>;

export function loadVersions(templateId: string): TemplateVersion[] {
  return read<VersionMap>(VKEY, {})[templateId] ?? [];
}

function writeVersions(map: VersionMap) {
  localStorage.setItem(VKEY, JSON.stringify(map));
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
