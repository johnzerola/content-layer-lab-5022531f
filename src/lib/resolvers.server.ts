// Resolvedores de link por plataforma (rodam só no servidor).
// Cada resolver devolve a URL direta do arquivo de vídeo, quando a plataforma
// disponibiliza uma API pública para isso. Plataformas que não expõem download
// (YouTube, Instagram, Facebook) só funcionam através de uma instância
// cobalt (self-host) configurada em COBALT_API_URL.

export interface ResolverHit {
  videoUrl: string;
  headers?: Record<string, string>;
  title?: string;
  thumbnail?: string;
  source: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function getJson(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** TikTok — API pública tikwm (sem chave). */
export async function resolveTikTok(url: string): Promise<ResolverHit | null> {
  const j = await getJson(`https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`);
  const d = j?.data;
  const play: string | undefined = d?.hdplay || d?.play || d?.wmplay;
  if (!play) return null;
  const abs = play.startsWith("http") ? play : `https://www.tikwm.com${play}`;
  return {
    videoUrl: abs,
    ...(d?.title ? { title: String(d.title).slice(0, 80) } : {}),
    ...(d?.cover ? { thumbnail: String(d.cover) } : {}),
    source: "tiktok",
  };
}

/** X / Twitter — API pública fxtwitter. */
export async function resolveTwitter(url: string): Promise<ResolverHit | null> {
  const m = url.match(/(?:twitter|x)\.com\/([^/]+)\/status\/(\d+)/i);
  if (!m) return null;
  const j = await getJson(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`);
  const media = j?.tweet?.media?.videos?.[0];
  if (!media?.url) return null;
  return {
    videoUrl: media.url,
    ...(j?.tweet?.text ? { title: String(j.tweet.text).slice(0, 80) } : {}),
    ...(media.thumbnail_url ? { thumbnail: media.thumbnail_url } : {}),
    source: "twitter",
  };
}

/** Reddit — o próprio post em .json expõe o fallback_url. */
export async function resolveReddit(url: string): Promise<ResolverHit | null> {
  const clean = url.split("?")[0]!.replace(/\/$/, "");
  const j = await getJson(`${clean}.json`);
  const post = Array.isArray(j) ? j[0]?.data?.children?.[0]?.data : j?.data?.children?.[0]?.data;
  const v = post?.secure_media?.reddit_video ?? post?.media?.reddit_video;
  const fallback: string | undefined = v?.fallback_url;
  if (!fallback) return null;
  return {
    videoUrl: fallback.replace(/\?source=fallback$/, ""),
    ...(post?.title ? { title: String(post.title).slice(0, 80) } : {}),
    source: "reddit",
  };
}

/** Streamable — API pública oficial. */
export async function resolveStreamable(url: string): Promise<ResolverHit | null> {
  const id = url.match(/streamable\.com\/(?:e\/)?([\w-]+)/i)?.[1];
  if (!id) return null;
  const j = await getJson(`https://api.streamable.com/videos/${id}`);
  const file = j?.files?.mp4?.url ?? j?.files?.["mp4-mobile"]?.url;
  if (!file) return null;
  const abs = file.startsWith("http") ? file : `https:${file}`;
  return { videoUrl: abs, ...(j?.title ? { title: String(j.title) } : {}), source: "streamable" };
}

/** Vimeo — config player público (vídeos não restritos). */
export async function resolveVimeo(url: string): Promise<ResolverHit | null> {
  const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1];
  if (!id) return null;
  const j = await getJson(`https://player.vimeo.com/video/${id}/config`);
  const files: any[] = j?.request?.files?.progressive ?? [];
  const best = files.sort((a, b) => (b?.height ?? 0) - (a?.height ?? 0))[0];
  if (!best?.url) return null;
  return {
    videoUrl: best.url,
    ...(j?.video?.title ? { title: String(j.video.title) } : {}),
    ...(j?.video?.thumbs?.base ? { thumbnail: String(j.video.thumbs.base) } : {}),
    source: "vimeo",
  };
}


/* ------------------------------------------------------------------ */
/* YouTube — instâncias públicas Piped / Invidious (sem chave)          */
/* ------------------------------------------------------------------ */

const PIPED = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
];

const INVIDIOUS = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yewtu.be",
];

export function youtubeId(url: string): string | null {
  const m =
    url.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/i)?.[1];
  return m ?? null;
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export async function resolveYouTube(url: string): Promise<ResolverHit | null> {
  const id = youtubeId(url);
  if (!id) return null;

  for (const base of [...envList("PIPED_API_URL"), ...PIPED]) {
    const j = await getJson(`${base}/streams/${id}`);
    const streams: any[] = j?.videoStreams ?? [];
    const muxed = streams
      .filter((s) => s?.url && s?.videoOnly === false)
      .sort((a, b) => (b?.height ?? 0) - (a?.height ?? 0))[0];
    if (muxed?.url) {
      return {
        videoUrl: muxed.url,
        ...(j?.title ? { title: String(j.title).slice(0, 80) } : {}),
        ...(j?.thumbnailUrl ? { thumbnail: String(j.thumbnailUrl) } : {}),
        source: "youtube",
      };
    }
  }

  for (const base of [...envList("INVIDIOUS_API_URL"), ...INVIDIOUS]) {
    const j = await getJson(`${base}/api/v1/videos/${id}`);
    const f: any[] = j?.formatStreams ?? [];
    const best = f
      .filter((s) => s?.url)
      .sort((a, b) => (Number(b?.height ?? 0) || 0) - (Number(a?.height ?? 0) || 0))[0];
    if (best?.url) {
      return {
        videoUrl: best.url,
        ...(j?.title ? { title: String(j.title).slice(0, 80) } : {}),
        source: "youtube",
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Instagram — espelhos públicos que expõem og:video                    */
/* ------------------------------------------------------------------ */

async function ogVideo(url: string): Promise<{ video?: string; title?: string; thumb?: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "facebookexternalhit/1.1", accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 800_000);
    const meta = (k: string) =>
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`, "i"))?.[1];
    const video = meta("og:video:secure_url") ?? meta("og:video:url") ?? meta("og:video");
    const out: { video?: string; title?: string; thumb?: string } = {};
    if (video) out.video = video.replace(/&amp;/g, "&");
    const t = meta("og:title");
    if (t) out.title = t.slice(0, 80);
    const th = meta("og:image");
    if (th) out.thumb = th;
    return out;
  } catch {
    return null;
  }
}

export async function resolveInstagram(url: string): Promise<ResolverHit | null> {
  const path = url.replace(/^https?:\/\/(?:www\.)?instagram\.com/i, "").split("?")[0] ?? "";
  const mirrors = [`https://www.ddinstagram.com${path}`, `https://d.ddinstagram.com${path}`, `https://kkinstagram.com${path}`];
  for (const m of mirrors) {
    const og = await ogVideo(m);
    if (og?.video) {
      return {
        videoUrl: og.video,
        ...(og.title ? { title: og.title } : {}),
        ...(og.thumb ? { thumbnail: og.thumb } : {}),
        source: "instagram",
      };
    }
  }
  return null;
}

/** Facebook / Kwai / Pinterest — tenta og:video da própria página. */
export async function resolveOpenGraph(url: string): Promise<ResolverHit | null> {
  const og = await ogVideo(url);
  if (!og?.video) return null;
  return {
    videoUrl: og.video,
    ...(og.title ? { title: og.title } : {}),
    ...(og.thumb ? { thumbnail: og.thumb } : {}),
    source: new URL(url).hostname.replace(/^www\./, ""),
  };
}

/**
 * Cobalt (self-host) — cobre YouTube, Instagram, Facebook, Twitch, Pinterest,
 * Snapchat, Bluesky, Dailymotion, SoundCloud e outros.
 * Configure COBALT_API_URL (e COBALT_API_KEY, se a instância exigir).
 */
function cobaltBases(): string[] {
  const list = [process.env["COBALT_API_URL"] ?? "", ...(process.env["COBALT_API_URLS"] ?? "").split(",")];
  return list.map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
}

export function cobaltConfigured(): boolean {
  return cobaltBases().length > 0;
}

export async function resolveWithCobalt(url: string): Promise<ResolverHit | null> {
  for (const base of cobaltBases()) {
    const hit = await cobaltCall(base, url);
    if (hit) return hit;
  }
  return null;
}

async function cobaltCall(base: string, url: string): Promise<ResolverHit | null> {
  const key = process.env["COBALT_API_KEY"];
  try {
    const res = await fetch(base + "/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": UA,
        ...(key ? { authorization: key.startsWith("Api-Key") ? key : `Api-Key ${key}` } : {}),
      },
      body: JSON.stringify({ url, videoQuality: "1080", filenameStyle: "basic", downloadMode: "auto" }),
    });
    const j: any = await res.json().catch(() => null);
    if (!j) return null;
    if (j.status === "redirect" || j.status === "tunnel" || j.status === "stream") {
      return { videoUrl: j.url, ...(j.filename ? { title: String(j.filename) } : {}), source: "cobalt" };
    }
    if (j.status === "picker") {
      const first = (j.picker as any[])?.find((p) => p?.type === "video" || p?.url);
      if (first?.url) return { videoUrl: first.url, source: "cobalt" };
    }
    return null;
  } catch {
    return null;
  }
}

export function platformOf(host: string): string {
  const h = host.replace(/^www\./, "").toLowerCase();
  if (/youtube\.com|youtu\.be|youtube-nocookie\.com/.test(h)) return "youtube";
  if (/instagram\.com|instagr\.am/.test(h)) return "instagram";
  if (/tiktok\.com/.test(h)) return "tiktok";
  if (/facebook\.com|fb\.watch/.test(h)) return "facebook";
  if (/twitter\.com|x\.com/.test(h)) return "twitter";
  if (/reddit\.com|redd\.it/.test(h)) return "reddit";
  if (/vimeo\.com/.test(h)) return "vimeo";
  if (/streamable\.com/.test(h)) return "streamable";
  if (/twitch\.tv/.test(h)) return "twitch";
  if (/pinterest\.|pin\.it/.test(h)) return "pinterest";
  if (/kwai\.com|kwai-video/.test(h)) return "kwai";
  if (/dailymotion\.com|dai\.ly/.test(h)) return "dailymotion";
  return h;
}
