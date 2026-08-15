import { createFileRoute } from "@tanstack/react-router";
import { safeRemoteUrl } from "@/lib/remote-url";
import { mediaProxyTicket, verifyMediaProxyTicket } from "@/lib/cleaner.server";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "range,content-type",
  "access-control-expose-headers": "content-length,content-range",
};

function proxied(u: string) {
  return `/api/public/hls-proxy?t=${encodeURIComponent(mediaProxyTicket(u, {}, 10 * 60))}`;
}

/** Reescreve as URLs de um playlist HLS para passarem por este proxy. */
function rewritePlaylist(text: string, base: URL): string {
  return text
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith("#")) {
        // atributos com URI="..." (chaves, mapas, mídias alternativas)
        return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${proxied(new URL(u, base).toString())}"`);
      }
      try {
        return proxied(new URL(t, base).toString());
      } catch {
        return line;
      }
    })
    .join("\n");
}

/**
 * Proxy de HLS (m3u8 + segmentos) para conseguir tocar/gravar a live no
 * navegador sem esbarrar em CORS.
 */
export const Route = createFileRoute("/api/public/hls-proxy")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const ticket = verifyMediaProxyTicket(new URL(request.url).searchParams.get("t"));
        if (!ticket) return new Response("invalid or expired ticket", { status: 401, headers: CORS });
        const target = safeRemoteUrl(ticket.url);
        if (!target) return new Response("url not allowed", { status: 400, headers: CORS });

        const range = request.headers.get("range");
        const headers = new Headers(ticket.headers);
        if (!headers.has("user-agent")) headers.set("user-agent", UA);
        if (!headers.has("accept")) headers.set("accept", "*/*");
        if (!headers.has("referer")) headers.set("referer", `${target.protocol}//${target.host}/`);
        if (range) headers.set("range", range);

        const upstream = await fetch(target.toString(), {
          redirect: "manual",
          headers,
        }).catch(() => null);

        if (upstream && upstream.status >= 300 && upstream.status < 400) {
          const location = upstream.headers.get("location");
          const next = location ? safeRemoteUrl(new URL(location, target).toString()) : null;
          return next
            ? new Response("redirect requires fresh ticket", { status: 409, headers: CORS })
            : new Response("redirect not allowed", { status: 400, headers: CORS });
        }

        /*
         * Do not follow redirects automatically. Each rewritten playlist entry
         * receives its own signed ticket so the next destination is validated
         * before the server fetches it.
         */
        const finalUpstream = upstream;

        if (!finalUpstream || !finalUpstream.ok || !finalUpstream.body) {
          return new Response("upstream error", { status: 502, headers: CORS });
        }

        const type = (finalUpstream.headers.get("content-type") ?? "").toLowerCase();
        const isPlaylist =
          /mpegurl/.test(type) || /\.m3u8(\?|$)/i.test(target.pathname + target.search);

        if (isPlaylist) {
          const text = await finalUpstream.text();
          return new Response(rewritePlaylist(text, target), {
            status: 200,
            headers: {
              ...CORS,
              "content-type": "application/vnd.apple.mpegurl",
              "cache-control": "no-store",
            },
          });
        }

        const responseHeaders = new Headers(CORS);
        responseHeaders.set("content-type", type || "video/mp2t");
        responseHeaders.set("cache-control", "no-store");
        const len = finalUpstream.headers.get("content-length");
        if (len) responseHeaders.set("content-length", len);
        const cr = finalUpstream.headers.get("content-range");
        if (cr) responseHeaders.set("content-range", cr);

        return new Response(finalUpstream.body, { status: finalUpstream.status, headers: responseHeaders });
      },
    },
  },
});
