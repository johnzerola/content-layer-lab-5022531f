import { createServerFn } from "@tanstack/react-start";

export interface ResolvedVideo {
  ok: boolean;
  /** URL direta do arquivo de vídeo (para baixar via proxy) */
  videoUrl?: string;
  title?: string;
  thumbnail?: string;
  source?: string;
  message?: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function isPrivateHost(host: string) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h === "0.0.0.0") return true;
  if (/^\[?::1\]?$/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export function safeRemoteUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (isPrivateHost(u.hostname)) return null;
  return u;
}

function pickMeta(html: string, keys: string[]) {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
      "i",
    );
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (content) return content.replace(/&amp;/g, "&");
  }
  return undefined;
}

/**
 * Recebe o link de uma página (post, artigo, CDN) e tenta descobrir a URL
 * direta do arquivo de vídeo, sem precisar de upload manual.
 */
export const resolveVideoLink = createServerFn({ method: "POST" })
  .inputValidator((input: { url: string }) => {
    if (!input?.url || typeof input.url !== "string") throw new Error("link inválido");
    return { url: input.url.trim() };
  })
  .handler(async ({ data }): Promise<ResolvedVideo> => {
    const target = safeRemoteUrl(data.url);
    if (!target) return { ok: false, message: "Link inválido ou não permitido." };

    const host = target.hostname.replace(/^www\./, "");

    // 1) já é um arquivo de vídeo?
    if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(target.pathname + target.search)) {
      return { ok: true, videoUrl: target.toString(), title: target.pathname.split("/").pop() ?? "video", source: host };
    }

    let head: Response | null = null;
    try {
      head = await fetch(target.toString(), { method: "HEAD", headers: { "user-agent": UA } });
    } catch {
      head = null;
    }
    const headType = head?.headers.get("content-type") ?? "";
    if (headType.startsWith("video/")) {
      return { ok: true, videoUrl: target.toString(), title: target.pathname.split("/").pop() ?? "video", source: host };
    }

    // 2) raspar a página em busca de og:video / <video src>
    let html = "";
    try {
      const res = await fetch(target.toString(), {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
      if (!res.ok) return { ok: false, message: `A página respondeu ${res.status}.` };
      html = (await res.text()).slice(0, 2_000_000);
    } catch {
      return { ok: false, message: "Não consegui abrir esse link." };
    }

    const title =
      pickMeta(html, ["og:title", "twitter:title"]) ?? html.match(/<title[^>]*>([^<]{1,120})/i)?.[1]?.trim();
    const thumbnail = pickMeta(html, ["og:image", "twitter:image"]);

    const candidates = [
      pickMeta(html, ["og:video:secure_url", "og:video:url", "og:video", "twitter:player:stream"]),
      html.match(/<video[^>]+src=["']([^"']+\.(?:mp4|webm|mov)[^"']*)["']/i)?.[1],
      html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|webm|mov)[^"']*)["']/i)?.[1],
      html.match(/"(?:contentUrl|video_url|playAddr|downloadAddr)"\s*:\s*"([^"]+)"/i)?.[1],
      html.match(/https?:\\?\/\\?\/[^"'\s]+\.mp4[^"'\s]*/i)?.[0],
    ].filter(Boolean) as string[];

    for (const raw of candidates) {
      const cleaned = raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
      const abs = safeRemoteUrl(cleaned.startsWith("http") ? cleaned : new URL(cleaned, target).toString());
      if (abs) {
        return {
          ok: true,
          videoUrl: abs.toString(),
          ...(title ? { title } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          source: host,
        };
      }
    }

    const protectedHost = /youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com/.test(host);
    return {
      ok: false,
      ...(title ? { title } : {}),
      source: host,
      message: protectedHost
        ? `${host} bloqueia download direto. Cole o link do arquivo .mp4 ou envie o arquivo.`
        : "Não encontrei um arquivo de vídeo nessa página.",
    };
  });
