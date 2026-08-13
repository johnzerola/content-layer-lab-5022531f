import { createFileRoute } from "@tanstack/react-router";
import { safeRemoteUrl } from "@/lib/remote-url";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "range,content-type",
  "access-control-expose-headers": "content-length,content-range",
};

function proxied(u: string) {
  return `/api/public/hls-proxy?u=${encodeURIComponent(u)}`;
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
        const raw = new URL(request.url).searchParams.get("u");
        if (!raw) return new Response("missing url", { status: 400, headers: CORS });
        const target = safeRemoteUrl(raw);
        if (!target) return new Response("url not allowed", { status: 400, headers: CORS });

        const range = request.headers.get("range");
        const upstream = await fetch(target.toString(), {
          headers: {
            "user-agent": UA,
            accept: "*/*",
            referer: `${target.protocol}//${target.host}/`,
            ...(range ? { range } : {}),
          },
          redirect: "follow",
        }).catch(() => null);

        if (!upstream || !upstream.ok || !upstream.body) {
          return new Response("upstream error", { status: 502, headers: CORS });
        }

        const type = (upstream.headers.get("content-type") ?? "").toLowerCase();
        const isPlaylist =
          /mpegurl/.test(type) || /\.m3u8(\?|$)/i.test(target.pathname + target.search);

        if (isPlaylist) {
          const text = await upstream.text();
          return new Response(rewritePlaylist(text, target), {
            status: 200,
            headers: {
              ...CORS,
              "content-type": "application/vnd.apple.mpegurl",
              "cache-control": "no-store",
            },
          });
        }

        const headers = new Headers(CORS);
        headers.set("content-type", type || "video/mp2t");
        headers.set("cache-control", "no-store");
        const len = upstream.headers.get("content-length");
        if (len) headers.set("content-length", len);
        const cr = upstream.headers.get("content-range");
        if (cr) headers.set("content-range", cr);

        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});
