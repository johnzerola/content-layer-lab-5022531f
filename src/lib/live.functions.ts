import { createServerFn } from "@tanstack/react-start";

export interface LiveCheck {
  live: boolean;
  platform?: "x" | "kick" | "tiktok" | "hls" | "web";
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

export function kickHandleOf(input: string): string | null {
  const clean = input.trim();
  if (/^kick:[A-Za-z0-9_][\w-]{1,38}$/i.test(clean)) return clean.replace(/^kick:/i, "");
  return clean.match(/kick\.com\/(?:video\/)?([A-Za-z0-9_][\w-]{1,38})(?:[/?#]|$)/i)?.[1] ?? null;
}

export function tiktokHandleOf(input: string): string | null {
  const clean = input.trim();
  if (/^tiktok:@?[\w.]{1,24}$/i.test(clean)) return clean.replace(/^tiktok:/i, "").replace(/^@/, "");
  return clean.match(/tiktok\.com\/@([\w.]{1,24})(?:\/live)?/i)?.[1] ?? null;
}

export function handleOf(input: string): string | null {
  const clean = input.trim();
  if (/^x:@?[\w.]{1,20}$/i.test(clean)) return clean.replace(/^x:/i, "").replace(/^@/, "");
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
    platform: "x",
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

async function fromKickChannel(handle: string): Promise<LiveCheck | null> {
  const slug = handle.replace(/^@/, "");
  const data = await getJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`);
  const stream = data?.livestream ?? data?.stream ?? null;
  const playback =
    stream?.playback_url ??
    stream?.source ??
    data?.playback_url ??
    data?.streamer_channel?.playback_url;
  if (!playback || typeof playback !== "string") {
    return {
      live: false,
      platform: "kick",
      handle: slug,
      message: `${slug} não está ao vivo no Kick agora ou a API pública não expôs o HLS.`,
      needsUrl: true,
    };
  }
  return {
    live: true,
    platform: "kick",
    hls: playback,
    handle: slug,
    title: String(stream?.session_title ?? data?.user?.username ?? slug).slice(0, 90),
    thumbnail: typeof stream?.thumbnail?.url === "string" ? stream.thumbnail.url : undefined,
  };
}

async function fromTikTokPage(input: string, handle?: string): Promise<LiveCheck | null> {
  const url = /^https?:\/\//i.test(input)
    ? input
    : `https://www.tiktok.com/@${encodeURIComponent((handle ?? input).replace(/^@/, ""))}/live`;
  const html = await getText(url);
  const hls = html ? m3u8In(html) : null;
  if (hls) {
    return {
      live: true,
      platform: "tiktok",
      hls,
      ...(handle ? { handle } : {}),
      message: "live TikTok pública com HLS embutido",
    };
  }
  return {
    live: false,
    platform: "tiktok",
    ...(handle ? { handle } : {}),
    message:
      "Não consegui obter o HLS público do TikTok. Cole o link .m3u8 direto ou configure um resolvedor dedicado no worker.",
    needsUrl: true,
  };
}

/**
 * Verifica se um perfil do X está ao vivo (ou lê o link direto de uma live)
 * e devolve o playlist HLS para o monitor gravar.
 */
export const checkXLive = createServerFn({ method: "POST" })
  .validator((input: { target: string }) => {
    const target = String(input?.target ?? "").trim();
    if (!target) throw new Error("informe o @ ou o link da live");
    return { target: target.slice(0, 300) };
  })
  .handler(async ({ data }): Promise<LiveCheck> => {
    const target = data.target;

    // 1) já é um playlist HLS
    if (/^https?:\/\/[^\s]+\.m3u8(\?|$)/i.test(target)) {
      return { live: true, platform: "hls", hls: target, message: "playlist HLS direta" };
    }

    // 2) Kick: canal ou link da live
    const kickHandle = kickHandleOf(target);
    if (kickHandle) {
      const hit = await fromKickChannel(kickHandle);
      if (hit) return hit;
    }

    // 3) TikTok: @handle/live, link direto ou prefixo tiktok:@handle
    const tiktokHandle = tiktokHandleOf(target);
    if (tiktokHandle || /tiktok\.com/i.test(target)) {
      const hit = await fromTikTokPage(target, tiktokHandle ?? undefined);
      if (hit) return hit;
    }

    // 4) link de broadcast / space
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

    // 5) @perfil — por padrão procura uma live recente no X/Twitter
    const handle = handleOf(target);
    if (handle) {
      const hit = await fromProfile(handle);
      if (hit) return hit;
      // último recurso: página pública do perfil pode expor um m3u8
      const html = await getText(`https://x.com/${encodeURIComponent(handle)}`);
      const url = html ? m3u8In(html) : null;
      if (url) return { live: true, platform: "x", hls: url, handle };
      return {
        live: false,
        handle,
        message: `@${handle} não está ao vivo agora (ou o X não expõe a transmissão publicamente).`,
        needsUrl: true,
      };
    }

    // 6) qualquer outra página com HLS embutido
    const html = await getText(target);
    const url = html ? m3u8In(html) : null;
    if (url) return { live: true, platform: "web", hls: url };

    return {
      live: false,
      message: "Não achei transmissão nesse endereço. Cole o link direto da live (x.com/i/broadcasts/... ou .m3u8).",
      needsUrl: true,
    };
  });
