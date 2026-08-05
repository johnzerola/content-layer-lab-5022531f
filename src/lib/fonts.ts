import type { CustomFont } from "./template";

const loaded = new Set<string>();

/** Registra uma fonte enviada pelo usuário no documento. */
export async function registerFont(f: CustomFont) {
  if (typeof document === "undefined" || loaded.has(f.name)) return;
  try {
    const face = new FontFace(f.name, `url(${f.dataUrl})`);
    await face.load();
    (document.fonts as unknown as { add: (x: FontFace) => void }).add(face);
    loaded.add(f.name);
  } catch (err) {
    console.warn("não consegui carregar a fonte", f.name, err);
  }
}

export async function registerFonts(fonts?: CustomFont[]) {
  for (const f of fonts ?? []) await registerFont(f);
}

export const BUILTIN_FONTS = [
  "Inter, sans-serif",
  "Georgia, serif",
  "Impact, sans-serif",
  "Courier New, monospace",
  "Arial Black, sans-serif",
];

export async function fileToFont(file: File): Promise<CustomFont> {
  const dataUrl = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(file);
  });
  const name = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, "").replace(/[^\w\- ]+/g, "");
  const font = { name: name || `Fonte ${Date.now()}`, dataUrl };
  await registerFont(font);
  return font;
}
