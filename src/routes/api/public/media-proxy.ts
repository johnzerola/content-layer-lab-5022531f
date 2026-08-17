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
        const headers = new Headers(ticket.headers);
        if (!headers.has("user-agent")) {
          headers.set(
            "user-agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          );
        }
        headers.set("accept", "video/*,application/octet-stream;q=0.9,*/*;q=0.5");
        if (!headers.has("referer")) headers.set("referer", `${target.protocol}//${target.host}/`);

        let upstream: Response | null = null;
        for (let redirect = 0; redirect <= 5; redirect += 1) {
          upstream = await fetch(target.toString(), { headers, redirect: "manual" }).catch(() => null);
          if (!upstream || !REDIRECT_CODES.has(upstream.status)) break;
          const location: string | null = upstream.headers.get("location");
          const next: URL | null = location
            ? safeRemoteUrl(new URL(location, target).toString())
            : null;
          if (!next) return new Response("redirect not allowed", { status: 400 });
          target = next;
          if (redirect === 5) return new Response("too many redirects", { status: 502 });
        }

        if (!upstream || !upstream.ok || !upstream.body) {
          return new Response("upstream error", { status: 502 });
        }

        const type = upstream.headers.get("content-type") ?? "";
        if (!/^(video\/|application\/octet-stream|binary\/)/i.test(type)) {
          return new Response("not a video", { status: 415 });
        }
        const len = Number(upstream.headers.get("content-length") ?? 0);
        if (len > MAX_BYTES) return new Response("file too large", { status: 413 });

        const reader = upstream.body.getReader();
        let received = 0;
        const limitedBody = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const chunk = await reader.read();
            if (chunk.done) {
              controller.close();
              return;
            }
            received += chunk.value.byteLength;
            if (received > MAX_BYTES) {
              await reader.cancel("file too large");
              controller.error(new Error("file too large"));
              return;
            }
            controller.enqueue(chunk.value);
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });

        return new Response(limitedBody, {
          status: 200,
          headers: {
            "content-type": type.startsWith("video/") ? type : "video/mp4",
            "content-disposition": "inline",
            "x-content-type-options": "nosniff",
            "cache-control": "no-store",
            ...(len ? { "content-length": String(len) } : {}),
          },
        });
      },
    },
  },
});
