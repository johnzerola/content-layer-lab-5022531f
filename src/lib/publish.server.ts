import type { PostKind, PublishErrorCode, SocialProvider } from "@/lib/publishing";

export type PublishInput = {
  kind: PostKind;
  caption: string;
  videoUrl: string;
  username: string;
  accountId?: string;
  platform?: string;
  provider?: SocialProvider;
  providerAccountId?: string | null;
};

export type PublishResult =
  | { ok: true; permalink?: string; providerPostId?: string }
  | { ok: false; error: string; code: PublishErrorCode; retryable: boolean };

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function nestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else {
      current = asObject(current)?.[key];
    }
  }
  return typeof current === "string" ? current : undefined;
}

function providerFailure(provider: string, status: number, payload: unknown): PublishResult {
  const detail = JSON.stringify(payload)?.slice(0, 300) ?? "resposta inválida";
  if (status === 401 || status === 403) {
    return { ok: false, code: "AUTH_INVALID", retryable: false, error: `${provider}: credencial inválida.` };
  }
  if (status === 429) {
    return { ok: false, code: "PROVIDER_RATE_LIMIT", retryable: true, error: `${provider}: limite temporário atingido.` };
  }
  if (status >= 500) {
    return { ok: false, code: "PROVIDER_TEMPORARY_ERROR", retryable: true, error: `${provider} [${status}]: ${detail}` };
  }
  return { ok: false, code: "PROVIDER_PERMANENT_ERROR", retryable: false, error: `${provider} [${status}]: ${detail}` };
}

export function activeProvider(requested?: SocialProvider): "ayrshare" | "meta" | null {
  if (requested === "ayrshare") return process.env["AYRSHARE_API_KEY"] ? "ayrshare" : null;
  if (requested === "meta") {
    return process.env["META_ACCESS_TOKEN"] && process.env["META_IG_USER_ID"] ? "meta" : null;
  }
  if (requested && requested !== "pending") return null;
  if (process.env["AYRSHARE_API_KEY"]) return "ayrshare";
  if (process.env["META_ACCESS_TOKEN"] && process.env["META_IG_USER_ID"]) return "meta";
  return null;
}

export async function publish(input: PublishInput): Promise<PublishResult> {
  if (input.platform && input.platform !== "instagram") {
    return {
      ok: false,
      code: "CAPABILITY_UNAVAILABLE",
      retryable: false,
      error: `Publicação para ${input.platform} ainda não está disponível.`,
    };
  }

  const provider = activeProvider(input.provider);
  if (!provider) {
    return {
      ok: false,
      code: "ACCOUNT_NOT_CONNECTED",
      retryable: false,
      error: "A conta ainda não possui um provedor de publicação configurado.",
    };
  }

  if (provider === "meta" && input.providerAccountId && input.providerAccountId !== process.env["META_IG_USER_ID"]) {
    return {
      ok: false,
      code: "ACCOUNT_MISMATCH",
      retryable: false,
      error: "A credencial Meta configurada não pertence à conta selecionada.",
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
        instagramOptions: input.kind === "stories" ? { stories: true } : { reels: input.kind === "reels" },
      }),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) return providerFailure("Ayrshare", res.status, payload);
    const permalink = nestedString(payload, ["postIds", "0", "postUrl"]);
    const providerPostId = nestedString(payload, ["postIds", "0", "id"]);
    return { ok: true, ...(permalink ? { permalink } : {}), ...(providerPostId ? { providerPostId } : {}) };
  } catch (error) {
    return {
      ok: false,
      code: "PROVIDER_TEMPORARY_ERROR",
      retryable: true,
      error: error instanceof Error ? error.message : "Ayrshare indisponível.",
    };
  }
}

async function publishMeta(input: PublishInput): Promise<PublishResult> {
  const token = process.env["META_ACCESS_TOKEN"];
  const igId = process.env["META_IG_USER_ID"];
  if (!token || !igId) {
    return { ok: false, code: "AUTH_INVALID", retryable: false, error: "Credencial Meta não configurada." };
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
    const created: unknown = await create.json().catch(() => null);
    const creationId = nestedString(created, ["id"]);
    if (!create.ok || !creationId) return providerFailure("Meta criar container", create.status, created);

    let finished = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const statusResponse = await fetch(
        `https://graph.facebook.com/v21.0/${creationId}?fields=status_code&access_token=${token}`,
      );
      const statusPayload: unknown = await statusResponse.json().catch(() => null);
      if (!statusResponse.ok) return providerFailure("Meta consultar container", statusResponse.status, statusPayload);
      const statusCode = nestedString(statusPayload, ["status_code"]);
      if (statusCode === "FINISHED") {
        finished = true;
        break;
      }
      if (statusCode === "ERROR") {
        return { ok: false, code: "MEDIA_INVALID", retryable: false, error: "Meta não processou o vídeo." };
      }
    }
    if (!finished) {
      return {
        ok: false,
        code: "PROVIDER_TEMPORARY_ERROR",
        retryable: true,
        error: "Meta ainda está processando o vídeo.",
      };
    }

    const publishResponse = await fetch(`${base}/media_publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ creation_id: creationId, access_token: token }),
    });
    const published: unknown = await publishResponse.json().catch(() => null);
    const providerPostId = nestedString(published, ["id"]);
    if (!publishResponse.ok || !providerPostId) {
      return providerFailure("Meta publicar", publishResponse.status, published);
    }
    return { ok: true, providerPostId };
  } catch (error) {
    return {
      ok: false,
      code: "PROVIDER_TEMPORARY_ERROR",
      retryable: true,
      error: error instanceof Error ? error.message : "Meta indisponível.",
    };
  }
}
