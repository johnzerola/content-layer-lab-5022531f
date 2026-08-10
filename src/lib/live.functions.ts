import { createServerFn } from "@tanstack/react-start";

export interface LiveCheck {
  live: boolean;
  /** playlist HLS da live (já pronta para tocar via proxy) */
  hls?: string;
  title?: string;
  thumbnail?: string;
  broadcastId?: string;
  handle?: string;
  /** mensagem amigável quando não deu para descobrir sozinho */
  message?: string;
  /** true quando precisamos que o usuário cole o link direto da live */
  needsUrl?: boolean;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow" });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 600_000);
  } catch {
    return null;
  }
}

export function broadcastIdOf(input: string): string | null {
  return (
    input.match(/(?:x|twitter)\.com\/i\/broadcasts\/([\w-]+)/i)?.[1] ??
    input.match(/pscp\.tv\/w\/([\w-]+)/i)?.[1] ??
    input.match(/(?:x|twitter)\.com\/i\/spaces\/([\w-]+)/i)?.[1] ??
    null
  );
}

export function handleOf(input: string): string | null {
  const clean = input.trim();
  if (/^@?[\w.]{1,20}$/.test(clean)) return clean.replace(/^@/, "");
  return clean.match(/(?:x|twitter)\.com\/(?!i\/)([A-Za-z0-9_]{1,20})/i)?.[1] ?? null;
}

/** Periscope/X broadcasts: descobre o HLS público de um broadcast id. */
async function fromBroadcast(id: string): Promise<LiveCheck | null> {
  const meta = await getJson(`https://proxsee.pscp.tv/api/v2/accessVideoPublic?broadcast_id=${encodeURIComponent(id)}`);
  const hls: string | undefined =
    meta?.hls_url || meta?.replay_url || meta?.https_hls_url || meta?.lhls_url || meta?.hlsUrl;
  if (!hls) return null;
  const b = meta?.broadcast ?? {};
  return {
    live: b?.state ? String(b.state).toLowerCase() === "running" : true,
    hls,
    broadcastId: id,
    ...(b?.status ? { title: String(b.status).slice(0, 90) } : {}),
    ...(b?.image_url ? { thumbnail: String(b.image_url) } : {}),
    ...(b?.username ? { handle: String(b.username) } : {}),
  };
}

/** Procura um m3u8 embutido na página. */
function m3u8In(html: string): string | null {
  const m = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
  return m ? m[0].replace(/&amp;/g, "&") : null;
}

/** Últimos posts do perfil (fxtwitter) — procura um link de broadcast/space recente. */
async function fromProfile(handle: string): Promise<LiveCheck | null> {
  const j = await getJson(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);
  const blob = JSON.stringify(j ?? {});
  const id = broadcastIdOf(blob);
  if (id) {
    const hit = await fromBroadcast(id);
    if (hit?.live) return { ...hit, handle };
  }
  return null;
}

/**
 * Verifica se um perfil do X está ao vivo (ou lê o link direto de uma live)
 * e devolve o playlist HLS para o monitor gravar.
 */
export const checkXLive = createServerFn({ method: "POST" })
  .inputValidator((input: { target: string }) => {
    const target = String(input?.target ?? "").trim();
    if (!target) throw new Error("informe o @ ou o link da live");
    return { target: target.slice(0, 300) };
  })
  .handler(async ({ data }): Promise<LiveCheck> => {
    const target = data.target;

    // 1) já é um playlist HLS
    if (/^https?:\/\/[^\s]+\.m3u8(\?|$)/i.test(target)) {
      return { live: true, hls: target, message: "playlist HLS direta" };
    }

    // 2) link de broadcast / space
    const id = broadcastIdOf(target);
    if (id) {
      const hit = await fromBroadcast(id);
      if (hit?.hls) return hit;
      return {
        live: false,
        broadcastId: id,
        message: "Esta transmissão não está no ar (ou não é pública).",
      };
    }

    // 3) @perfil — procura uma live recente
    const handle = handleOf(target);
    if (handle) {
      const hit = await fromProfile(handle);
      if (hit) return hit;
      // último recurso: página pública do perfil pode expor um m3u8
      const html = await getText(`https://x.com/${encodeURIComponent(handle)}`);
      const url = html ? m3u8In(html) : null;
      if (url) return { live: true, hls: url, handle };
      return {
        live: false,
        handle,
        message: `@${handle} não está ao vivo agora (ou o X não expõe a transmissão publicamente).`,
        needsUrl: true,
      };
    }

    // 4) qualquer outra página com HLS embutido
    const html = await getText(target);
    const url = html ? m3u8In(html) : null;
    if (url) return { live: true, hls: url };

    return {
      live: false,
      message: "Não achei transmissão nesse endereço. Cole o link direto da live (x.com/i/broadcasts/... ou .m3u8).",
      needsUrl: true,
    };
  });
