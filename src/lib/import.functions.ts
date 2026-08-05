import { createServerFn } from "@tanstack/react-start";

export interface ResolvedVideo {
  ok: boolean;
  /** URL direta do arquivo de vídeo (para baixar via proxy) */
  videoUrl?: string;
  title?: string;
  thumbnail?: string;
  source?: string;
  message?: string;
  /** plataforma que bloqueia download por link (YouTube, IG, TikTok...) */
  blocked?: boolean;
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
    const {
      platformOf,
      resolveTikTok,
      resolveTwitter,
      resolveReddit,
      resolveStreamable,
      resolveVimeo,
      resolveWithCobalt,
      cobaltConfigured,
    } = await import("./resolvers.server");
    const platform = platformOf(host);

    // 1) já é um arquivo de vídeo?
    if (/\.(mp4|mov|m4v|webm|mkv|ogv|3gp|avi|mpeg|mpg|ts)(\?|$)/i.test(target.pathname + target.search)) {
      return { ok: true, videoUrl: target.toString(), title: target.pathname.split("/").pop() ?? "video", source: host };
    }

    // 2) resolvers específicos por plataforma
    const byPlatform: Record<string, (u: string) => Promise<import("./resolvers.server").ResolverHit | null>> = {
      tiktok: resolveTikTok,
      twitter: resolveTwitter,
      reddit: resolveReddit,
      streamable: resolveStreamable,
      vimeo: resolveVimeo,
    };
    const chain = [byPlatform[platform], resolveWithCobalt].filter(Boolean) as ((
      u: string,
    ) => Promise<import("./resolvers.server").ResolverHit | null>)[];

    for (const fn of chain) {
      try {
        const hit = await fn(target.toString());
        if (hit?.videoUrl && safeRemoteUrl(hit.videoUrl)) {
          return {
            ok: true,
            videoUrl: hit.videoUrl,
            ...(hit.title ? { title: hit.title } : {}),
            ...(hit.thumbnail ? { thumbnail: hit.thumbnail } : {}),
            source: hit.source || host,
          };
        }
      } catch {
        /* tenta o próximo */
      }
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
      html.match(/<video[^>]+src=["']([^"']+\.(?:mp4|m4v|webm|mov|mkv|ogv|3gp|avi|mpeg|mpg|ts)[^"']*)["']/i)?.[1],
      html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|m4v|webm|mov|mkv|ogv|3gp|avi|mpeg|mpg|ts)[^"']*)["']/i)?.[1],
      html.match(/"(?:contentUrl|video_url|playAddr|downloadAddr)"\s*:\s*"([^"]+)"/i)?.[1],
      html.match(/https?:\\?\/\\?\/[^"'\s]+\.(?:mp4|m4v|webm|mov|mkv)[^"'\s]*/i)?.[0],
    ].filter(Boolean) as string[];

    const isPlayerPage = (u: URL) =>
      /\/embed\/|\/player|youtube\.com|youtu\.be|player\.vimeo\.com/.test(u.host + u.pathname) &&
      !/\.(mp4|m4v|mov|webm|mkv|ogv|3gp|avi|mpeg|mpg|ts)(\?|$)/i.test(u.pathname + u.search);


    for (const raw of candidates) {
      const cleaned = raw.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&");
      const abs = safeRemoteUrl(cleaned.startsWith("http") ? cleaned : new URL(cleaned, target).toString());
      if (abs && !isPlayerPage(abs)) {
        return {
          ok: true,
          videoUrl: abs.toString(),
          ...(title ? { title } : {}),
          ...(thumbnail ? { thumbnail } : {}),
          source: host,
        };
      }
    }

    const needsService = ["youtube", "instagram", "facebook", "twitch", "pinterest", "kwai"].includes(platform);
    return {
      ok: false,
      ...(title ? { title } : {}),
      source: host,
      blocked: needsService,
      message: needsService
        ? cobaltConfigured()
          ? `Não consegui obter esse vídeo do ${platform} pelo serviço configurado (pode ser privado, restrito por idade ou indisponível). Baixe o arquivo e arraste aqui.`
          : `${platform} não expõe download direto por link. Configure um serviço de resolução (COBALT_API_URL) para importar automaticamente, ou baixe o arquivo e arraste aqui.`
        : "Não encontrei um arquivo de vídeo nessa página. Cole um link direto do arquivo ou envie o vídeo.",
    };

  });
