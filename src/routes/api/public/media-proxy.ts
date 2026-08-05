import { createFileRoute } from "@tanstack/react-router";
import { safeRemoteUrl } from "@/lib/import.functions";

const MAX_BYTES = 500 * 1024 * 1024;

/**
 * Baixa o arquivo de vídeo remoto e devolve os bytes para o navegador
 * (evita bloqueio de CORS ao importar por link).
 */
export const Route = createFileRoute("/api/public/media-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("u");
        if (!raw) return new Response("missing url", { status: 400 });
        const target = safeRemoteUrl(raw);
        if (!target) return new Response("url not allowed", { status: 400 });

        const upstream = await fetch(target.toString(), {
          headers: {
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            accept: "video/*,*/*",
            referer: `${target.protocol}//${target.host}/`,
          },
          redirect: "follow",
        }).catch(() => null);

        if (!upstream || !upstream.ok || !upstream.body) {
          return new Response("upstream error", { status: 502 });
        }

        const type = upstream.headers.get("content-type") ?? "";
        if (!/^(video\/|application\/octet-stream|binary\/)/i.test(type)) {
          return new Response("not a video", { status: 415 });
        }
        const len = Number(upstream.headers.get("content-length") ?? 0);
        if (len > MAX_BYTES) return new Response("file too large", { status: 413 });

        return new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": type.startsWith("video/") ? type : "video/mp4",
            "cache-control": "no-store",
            ...(len ? { "content-length": String(len) } : {}),
          },
        });
      },
    },
  },
});
