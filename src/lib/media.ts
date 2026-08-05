// Formatos de vídeo aceitos na importação.

export const VIDEO_EXT = [
  "mp4",
  "m4v",
  "mov",
  "qt",
  "webm",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "f4v",
  "mpeg",
  "mpg",
  "mpe",
  "m2v",
  "mts",
  "m2ts",
  "ts",
  "3gp",
  "3g2",
  "ogv",
  "ogg",
  "asf",
  "rm",
  "rmvb",
  "divx",
  "vob",
  "hevc",
] as const;

export const VIDEO_EXT_RE = new RegExp(`\\.(${VIDEO_EXT.join("|")})$`, "i");
export const VIDEO_URL_EXT_RE = new RegExp(`\\.(${VIDEO_EXT.join("|")})(\\?|#|$)`, "i");

/** Atributo accept do input[type=file]. */
export const VIDEO_ACCEPT = ["video/*", ...VIDEO_EXT.map((e) => `.${e}`)].join(",");

export function isVideoFile(f: File): boolean {
  return f.type.startsWith("video/") || VIDEO_EXT_RE.test(f.name);
}

export function extOf(name: string): string {
  return (name.match(VIDEO_EXT_RE)?.[1] ?? "").toLowerCase();
}

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  ogg: "video/ogg",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  ts: "video/mp2t",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
};

export function guessMime(name: string, fallback = "video/mp4"): string {
  return MIME_BY_EXT[extOf(name)] ?? fallback;
}

/** O navegador consegue decodificar esse arquivo? (heurística via canPlayType) */
export function canBrowserDecode(f: File): boolean {
  if (typeof document === "undefined") return true;
  const el = document.createElement("video");
  const mime = f.type && f.type.startsWith("video/") ? f.type : guessMime(f.name, "");
  if (!mime) return true;
  const verdict = el.canPlayType(mime);
  if (verdict) return true;
  // alguns navegadores só respondem com codecs; testa os containers universais
  return ["mp4", "m4v", "mov", "webm", "ogv", "ogg", "3gp"].includes(extOf(f.name));
}
