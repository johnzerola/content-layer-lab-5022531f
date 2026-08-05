export type LayerId =
  | "video"
  | "watermark"
  | "avatar"
  | "name"
  | "handle"
  | "headline"
  | "cta";

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

export interface BoxLayer {
  x: number;
  y: number;
  w: number;
  h: number;
  visible: boolean;
  rotation: number;
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

export interface Template {
  id: string;
  name: string;
  version?: number;
  updatedAt?: number;
  background: string;
  video: VideoLayer;
  watermark: ImageLayer;
  avatar: ImageLayer;
  name_: TextLayer;
  handle: TextLayer;
  headline: TextLayer;
  cta: TextLayer;
  mirror: boolean;
  speed: number;
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
    },
    name_: text({ x: 260, y: 258, text: "Seu nome", size: 56, badge: true }),
    handle: text({
      x: 260,
      y: 325,
      text: "@seuusuario",
      size: 38,
      weight: "400",
      color: "#9aa0a6",
      h: 60,
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
    }),
    mirror: false,
    speed: 1,
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
};

const KEY = "vv.templates";

export function loadTemplates(): Template[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Template[]) : [];
  } catch {
    return [];
  }
}

export function saveTemplates(list: Template[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}
