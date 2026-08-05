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

export function loadTemplates(): Template[] {
  return read<Template[]>(KEY, []);
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
  return { ...base, ...parsed, id: base.id, version: 1, updatedAt: Date.now() };
}

