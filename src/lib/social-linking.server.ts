import type { MetaCredentials } from "@/lib/meta.server";
import { metaGraphBase } from "@/lib/meta.server";

export type LinkedSocialAccount = {
  id: string;
  platform: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  provider: string;
  provider_account_id: string | null;
  status: string;
  created_at: string;
};

export type MetaLinkErrorCode =
  | "LOGIN_REQUIRED"
  | "HANDLE_INVALID"
  | "META_TOKEN_MISSING"
  | "META_IG_ID_MISSING"
  | "META_AUTH_INVALID"
  | "META_RATE_LIMIT"
  | "META_TEMPORARY_ERROR"
  | "META_RESPONSE_INVALID"
  | "META_ACCOUNT_MISMATCH"
  | "ACCOUNT_OWNERSHIP_INVALID"
  | "PROVIDER_CONFLICT"
  | "DATABASE_ERROR";

export class MetaLinkError extends Error {
  constructor(
    public readonly code: MetaLinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MetaLinkError";
  }
}

export function normalizeInstagramHandle(value: string): string {
  const normalized = value.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(normalized)) {
    throw new MetaLinkError("HANDLE_INVALID", "Informe um @ do Instagram válido.");
  }
  return normalized;
}

export function configuredMetaCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): MetaCredentials {
  const accessToken = environment["META_ACCESS_TOKEN"]?.trim();
  if (!accessToken) {
    throw new MetaLinkError("META_TOKEN_MISSING", "A credencial Meta ainda não foi configurada.");
  }
  const igUserId = environment["META_IG_USER_ID"]?.trim();
  if (!igUserId) {
    throw new MetaLinkError("META_IG_ID_MISSING", "O Instagram User ID ainda não foi configurado.");
  }
  return { accessToken, igUserId };
}

type MetaIdentity = { id: string; username: string };

export async function fetchConfiguredMetaIdentity(
  credentials: MetaCredentials,
  dependencies: { fetch: typeof fetch; environment?: NodeJS.ProcessEnv } = { fetch },
): Promise<MetaIdentity> {
  let response: Response;
  try {
    response = await dependencies.fetch(
      `${metaGraphBase(dependencies.environment)}/${encodeURIComponent(credentials.igUserId)}?fields=id,username`,
      { headers: { authorization: `Bearer ${credentials.accessToken}` } },
    );
  } catch {
    throw new MetaLinkError(
      "META_TEMPORARY_ERROR",
      "A Meta está temporariamente indisponível. Tente novamente.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new MetaLinkError(
      "META_AUTH_INVALID",
      "A autorização do Instagram é inválida ou expirou.",
    );
  }
  if (response.status === 429) {
    throw new MetaLinkError(
      "META_RATE_LIMIT",
      "A Meta limitou temporariamente as solicitações. Tente novamente.",
    );
  }
  if (response.status >= 500) {
    throw new MetaLinkError(
      "META_TEMPORARY_ERROR",
      "A Meta está temporariamente indisponível. Tente novamente.",
    );
  }
  if (!response.ok) {
    throw new MetaLinkError(
      "META_AUTH_INVALID",
      "Não foi possível validar a autorização do Instagram.",
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  const object = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  const id = object && "id" in object && typeof object.id === "string" ? object.id : null;
  const username =
    object && "username" in object && typeof object.username === "string" ? object.username : null;
  if (!id || !username) {
    throw new MetaLinkError(
      "META_RESPONSE_INVALID",
      "A Meta retornou uma resposta inválida ao validar a conta.",
    );
  }
  return { id, username: normalizeInstagramHandle(username) };
}

export async function linkConfiguredInstagramAccount(input: {
  userId: string;
  requestedHandle: string;
  credentials: MetaCredentials;
  fetch?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
  persist: (data: {
    userId: string;
    handle: string;
    providerAccountId: string;
  }) => Promise<LinkedSocialAccount>;
}): Promise<{ account: LinkedSocialAccount }> {
  if (!input.userId)
    throw new MetaLinkError("LOGIN_REQUIRED", "Faça login para conectar uma conta.");
  const handle = normalizeInstagramHandle(input.requestedHandle);
  const identity = await fetchConfiguredMetaIdentity(input.credentials, {
    fetch: input.fetch ?? fetch,
    ...(input.environment ? { environment: input.environment } : {}),
  });
  if (identity.id !== input.credentials.igUserId) {
    throw new MetaLinkError(
      "META_ACCOUNT_MISMATCH",
      "A conta retornada pela Meta não corresponde à conta autorizada.",
    );
  }
  if (identity.username !== handle) {
    throw new MetaLinkError(
      "META_ACCOUNT_MISMATCH",
      "A conta informada não corresponde à conta Instagram autorizada.",
    );
  }
  return {
    account: await input.persist({
      userId: input.userId,
      handle,
      providerAccountId: identity.id,
    }),
  };
}
