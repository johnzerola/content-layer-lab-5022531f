// Provedor de publicação — plugável.
// Hoje nenhum provedor está configurado: o sistema mantém os posts na fila e
// registra o motivo. Ao definir as credenciais (Ayrshare ou app próprio da
// Meta), basta preencher o adaptador correspondente abaixo.

export type PublishInput = {
  accountId: string;
  platform: "instagram" | "tiktok" | "youtube";
  kind: "reels" | "feed" | "stories";
  caption: string;
  videoUrl: string;
  username: string;
  provider: string;
  providerAccountId: string;
  idempotencyKey: string;
};

export type PublishResult = { ok: true; permalink?: string } | { ok: false; error: string };

export function activeProvider(): "ayrshare" | "meta" | null {
  if (process.env["AYRSHARE_API_KEY"]) return "ayrshare";
  if (process.env["META_ACCESS_TOKEN"] && process.env["META_IG_USER_ID"]) return "meta";
  return null;
}

export async function publish(input: PublishInput): Promise<PublishResult> {
  const provider = activeProvider();
  if (!provider) {
    return {
      ok: false,
      error:
        "Nenhum provedor de publicação configurado. Adicione AYRSHARE_API_KEY ou as credenciais do app Meta para ativar o envio real.",
    };
  }
  if (input.provider !== provider || !input.providerAccountId) {
    return {
      ok: false,
      error: `Conta @${input.username} nao esta conectada ao provedor ativo (${provider}). Refaca a conexao OAuth/API antes de publicar.`,
    };
  }
  if (provider === "ayrshare") return publishAyrshare(input);
  return publishMeta(input);
}

async function publishAyrshare(input: PublishInput): Promise<PublishResult> {
  try {
    const res = await fetch("https://api.ayrshare.com/api/post", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env["AYRSHARE_API_KEY"]}`,
      },
      body: JSON.stringify({
        post: input.caption,
        platforms: ["instagram"],
        mediaUrls: [input.videoUrl],
        isVideo: true,
        profileKey: input.providerAccountId,
        idempotencyKey: input.idempotencyKey,
        instagramOptions: input.kind === "stories" ? { stories: true } : { reels: input.kind === "reels" },
      }),
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: `Ayrshare [${res.status}]: ${JSON.stringify(j)?.slice(0, 300)}` };
    const permalink = j?.postIds?.[0]?.postUrl;
    return permalink ? { ok: true, permalink } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function publishMeta(input: PublishInput): Promise<PublishResult> {
  const token = process.env["META_ACCESS_TOKEN"]!;
  const igId = input.providerAccountId;
  if (igId !== process.env["META_IG_USER_ID"]) {
    return {
      ok: false,
      error: `Conta @${input.username} nao corresponde a META_IG_USER_ID configurado. Publicacao bloqueada para evitar envio na conta errada.`,
    };
  }
  const base = `https://graph.facebook.com/v21.0/${igId}`;
  try {
    const mediaType = input.kind === "stories" ? "STORIES" : "REELS";
    const create = await fetch(`${base}/media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        media_type: mediaType,
        video_url: input.videoUrl,
        caption: input.kind === "stories" ? undefined : input.caption,
        access_token: token,
      }),
    });
    const created: any = await create.json().catch(() => null);
    if (!create.ok || !created?.id) {
      return { ok: false, error: `Meta criar container [${create.status}]: ${JSON.stringify(created)?.slice(0, 300)}` };
    }

    // a Meta baixa o arquivo de forma assíncrona; espera ficar pronto
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const st = await fetch(
        `https://graph.facebook.com/v21.0/${created.id}?fields=status_code&access_token=${token}`,
      );
      const sj: any = await st.json().catch(() => null);
      if (sj?.status_code === "FINISHED") break;
      if (sj?.status_code === "ERROR") return { ok: false, error: "Meta: falha ao processar o vídeo." };
    }

    const pub = await fetch(`${base}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creation_id: created.id, access_token: token }),
    });
    const pj: any = await pub.json().catch(() => null);
    if (!pub.ok || !pj?.id) {
      return { ok: false, error: `Meta publicar [${pub.status}]: ${JSON.stringify(pj)?.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
