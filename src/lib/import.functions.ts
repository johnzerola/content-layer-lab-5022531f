import { createServerFn } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mediaProxyTicket, workerResolveMedia } from "@/lib/cleaner.server";
import { safeRemoteUrl } from "@/lib/remote-url";

export interface ResolvedVideo {
  ok: boolean;
  /** URL direta do arquivo de vídeo (para baixar via proxy) */
  videoUrl?: string;
  /** Proxy assinado, curto e preparado com os headers exigidos pela origem. */
  proxyUrl?: string;
  ext?: string;
  title?: string;
  thumbnail?: string;
  source?: string;
  message?: string;
  /** plataforma que bloqueia download por link (YouTube, IG, TikTok...) */
  blocked?: boolean;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((input: { url: string }) => {
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
      resolveYouTube,
      resolveInstagram,
      resolveOpenGraph,
      resolveWithCobalt,
      cobaltConfigured,
    } = await import("./resolvers.server");
    const platform = platformOf(host);

    // O worker usa yt-dlp atualizado e e a fonte principal para posts publicos.
    // Mantemos os resolvedores abaixo como fallback enquanto o worker antigo
    // ainda nao tiver recebido esta versao.
    if (platform !== host && !cobaltConfigured()) {
      try {
        const media = await workerResolveMedia(target.toString());
        const ticket = mediaProxyTicket(media.url, media.headers);
        return {
          ok: true,
          videoUrl: media.url,
          proxyUrl: `/api/public/media-proxy?t=${encodeURIComponent(ticket)}`,
          ...(media.title ? { title: media.title } : {}),
          ...(media.thumbnail ? { thumbnail: media.thumbnail } : {}),
          source: media.source ?? platform,
          ext: media.ext ?? "mp4",
        };
      } catch {
        // Tenta Cobalt, API publica oficial ou OpenGraph na sequencia.
      }
    }

    // 1) já é um arquivo de vídeo?
    if (/\.(mp4|mov|m4v|webm|mkv|ogv|3gp|avi|mpeg|mpg|ts)(\?|$)/i.test(target.pathname + target.search)) {
      const ticket = mediaProxyTicket(target.toString());
      return {
        ok: true,
        videoUrl: target.toString(),
        proxyUrl: `/api/public/media-proxy?t=${encodeURIComponent(ticket)}`,
        title: target.pathname.split("/").pop() ?? "video",
        source: host,
      };
    }

    // 2) resolvers específicos por plataforma
    const byPlatform: Record<string, (u: string) => Promise<import("./resolvers.server").ResolverHit | null>> = {
      tiktok: resolveTikTok,
      twitter: resolveTwitter,
      reddit: resolveReddit,
      streamable: resolveStreamable,
      vimeo: resolveVimeo,
      youtube: resolveYouTube,
      instagram: resolveInstagram,
      facebook: resolveOpenGraph,
      pinterest: resolveOpenGraph,
      kwai: resolveOpenGraph,
      dailymotion: resolveOpenGraph,
    };
    const chain = [resolveWithCobalt, byPlatform[platform], resolveOpenGraph].filter(Boolean) as ((
      u: string,
    ) => Promise<import("./resolvers.server").ResolverHit | null>)[];

    for (const fn of chain) {
      try {
        const hit = await fn(target.toString());
        if (hit?.videoUrl && safeRemoteUrl(hit.videoUrl)) {
          const ticket = mediaProxyTicket(hit.videoUrl, hit.headers);
          return {
            ok: true,
            videoUrl: hit.videoUrl,
            proxyUrl: `/api/public/media-proxy?t=${encodeURIComponent(ticket)}`,
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
      const ticket = mediaProxyTicket(target.toString());
      return {
        ok: true,
        videoUrl: target.toString(),
        proxyUrl: `/api/public/media-proxy?t=${encodeURIComponent(ticket)}`,
        title: target.pathname.split("/").pop() ?? "video",
        source: host,
      };
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
        const ticket = mediaProxyTicket(abs.toString());
        return {
          ok: true,
          videoUrl: abs.toString(),
          proxyUrl: `/api/public/media-proxy?t=${encodeURIComponent(ticket)}`,
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
          ? `Não consegui obter esse vídeo do ${platform} (pode ser privado, restrito por idade ou indisponível). Baixe o arquivo e arraste aqui.`
          : `Não consegui baixar esse vídeo do ${platform} pelos serviços públicos (pode estar privado ou com restrição). Configure um resolvedor próprio (COBALT_API_URL) para importar sempre, ou baixe o arquivo e arraste aqui.`
        : "Não encontrei um arquivo de vídeo nessa página. Cole um link direto do arquivo ou envie o vídeo.",
    };

  });
