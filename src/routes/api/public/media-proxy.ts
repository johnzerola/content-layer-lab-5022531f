import { createFileRoute } from "@tanstack/react-router";
import { safeRemoteUrl } from "@/lib/remote-url";
import { verifyMediaProxyTicket } from "@/lib/cleaner.server";

const configuredMaxGb = Number(process.env["CLEANER_MAX_UPLOAD_GB"] ?? "2");
const MAX_BYTES = Math.max(0.05, Number.isFinite(configuredMaxGb) ? configuredMaxGb : 2) * 1024 ** 3;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * Baixa o arquivo de vídeo remoto e devolve os bytes para o navegador
 * (evita bloqueio de CORS ao importar por link).
 */
export const Route = createFileRoute("/api/public/media-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ticket = verifyMediaProxyTicket(new URL(request.url).searchParams.get("t"));
        if (!ticket) return new Response("invalid or expired ticket", { status: 401 });
        const initialTarget = safeRemoteUrl(ticket.url);
        if (!initialTarget) return new Response("url not allowed", { status: 400 });

        let target: URL = initialTarget;
        const requestHeaders = new Headers(ticket.headers);
        
        // Repassa o header Range do navegador para o upstream
        const browserRange = request.headers.get("range");
        if (browserRange) {
          requestHeaders.set("range", browserRange);
        }

        if (!requestHeaders.has("user-agent")) {
          requestHeaders.set(
            "user-agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          );
        }
        requestHeaders.set("accept", "video/*,application/octet-stream;q=0.9,*/*;q=0.5");
        if (!requestHeaders.has("referer")) requestHeaders.set("referer", `${target.protocol}//${target.host}/`);

        let upstream: Response | null = null;
        for (let redirect = 0; redirect <= 5; redirect += 1) {
          upstream = await fetch(target.toString(), { 
            headers: requestHeaders, 
            redirect: "manual" 
          }).catch(() => null);
          
          if (!upstream || !REDIRECT_CODES.has(upstream.status)) break;
          const location: string | null = upstream.headers.get("location");
          const next: URL | null = location
            ? safeRemoteUrl(new URL(location, target).toString())
            : null;
          if (!next) return new Response("redirect not allowed", { status: 400 });
          target = next;
          if (redirect === 5) return new Response("too many redirects", { status: 502 });
        }

        if (!upstream || !upstream.body) {
          return new Response("upstream error", { status: 502 });
        }

        const type = upstream.headers.get("content-type") ?? "";
        if (upstream.ok && !/^(video\/|application\/octet-stream|binary\/|audio\/)/i.test(type)) {
          return new Response("not a video", { status: 415 });
        }

        const responseHeaders = new Headers();
        responseHeaders.set("content-type", type.startsWith("video/") || type.startsWith("audio/") ? type : "video/mp4");
        responseHeaders.set("content-disposition", "inline");
        responseHeaders.set("x-content-type-options", "nosniff");
        responseHeaders.set("cache-control", "no-store");
        responseHeaders.set("accept-ranges", "bytes");

        // Repassa headers de conteúdo do upstream (Range, Length, etc)
        ["content-length", "content-range", "accept-ranges"].forEach(h => {
          const val = upstream!.headers.get(h);
          if (val) responseHeaders.set(h, val);
        });

        // Retorna o status original (pode ser 206 Partial Content)
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      },
    },
  },
});
