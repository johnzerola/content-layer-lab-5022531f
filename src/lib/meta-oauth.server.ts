import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { metaGraphBase } from "@/lib/meta.server";
import { MetaLinkError, normalizeInstagramHandle } from "@/lib/social-linking.server";

const OAUTH_TTL_MS = 10 * 60 * 1000;
const INSTAGRAM_AUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
];

type OAuthConfiguration = {
  appId: string;
  appSecret: string;
  redirectUri: string;
};

type OAuthState = {
  userId: string;
  expiresAt: number;
  nonce: string;
};

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function oauthConfiguration(environment: NodeJS.ProcessEnv = process.env): OAuthConfiguration {
  const appId = environment["META_APP_ID"]?.trim();
  const appSecret = environment["META_APP_SECRET"]?.trim();
  const explicitRedirect = environment["META_REDIRECT_URI"]?.trim();
  const siteUrl = environment["PUBLIC_SITE_URL"]?.trim().replace(/\/$/, "");
  const redirectUri = explicitRedirect || (siteUrl ? `${siteUrl}/integracoes/instagram/callback` : "");

  if (!appId || !appSecret || !redirectUri) {
    throw new MetaLinkError(
      "SERVER_CONFIG_MISSING",
      "O login do Instagram ainda não está configurado no servidor.",
    );
  }
  return { appId, appSecret, redirectUri };
}

function signState(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createInstagramOAuthState(
  userId: string,
  environment: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string {
  const { appSecret } = oauthConfiguration(environment);
  const payload = base64Url(
    JSON.stringify({
      userId,
      expiresAt: now + OAUTH_TTL_MS,
      nonce: randomBytes(24).toString("base64url"),
    } satisfies OAuthState),
  );
  return `${payload}.${signState(payload, appSecret)}`;
}

export function verifyInstagramOAuthState(
  state: string,
  userId: string,
  environment: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): void {
  const { appSecret } = oauthConfiguration(environment);
  const [payload, receivedSignature, extra] = state.split(".");
  if (!payload || !receivedSignature || extra) {
    throw new MetaLinkError("META_AUTH_INVALID", "A autorização do Instagram é inválida.");
  }

  const expectedSignature = signState(payload, appSecret);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new MetaLinkError("META_AUTH_INVALID", "A autorização do Instagram é inválida.");
  }

  let decoded: OAuthState;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  } catch {
    throw new MetaLinkError("META_AUTH_INVALID", "A autorização do Instagram é inválida.");
  }
  if (decoded.userId !== userId || decoded.expiresAt < now || !decoded.nonce) {
    throw new MetaLinkError("META_AUTH_INVALID", "A autorização do Instagram expirou.");
  }
}

export function instagramAuthorizationUrl(
  userId: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configuration = oauthConfiguration(environment);
  const url = new URL(INSTAGRAM_AUTH_URL);
  url.searchParams.set("enable_fb_login", "0");
  url.searchParams.set("force_authentication", "1");
  url.searchParams.set("client_id", configuration.appId);
  url.searchParams.set("redirect_uri", configuration.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", createInstagramOAuthState(userId, environment));
  return url.toString();
}

export async function exchangeInstagramAuthorizationCode(input: {
  code: string;
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}): Promise<{ accessToken: string; userId: string }> {
  const environment = input.environment ?? process.env;
  const configuration = oauthConfiguration(environment);
  const request = input.fetch ?? fetch;
  const body = new URLSearchParams({
    client_id: configuration.appId,
    client_secret: configuration.appSecret,
    grant_type: "authorization_code",
    redirect_uri: configuration.redirectUri,
    code: input.code.replace(/#_$/, ""),
  });
  const response = await request(INSTAGRAM_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  }).catch(() => null);

  if (!response || response.status >= 500 || response.status === 429) {
    throw new MetaLinkError(
      "META_TEMPORARY_ERROR",
      "A Meta está temporariamente indisponível. Tente novamente.",
    );
  }
  if (!response.ok) {
    throw new MetaLinkError("META_AUTH_INVALID", "O login do Instagram não pôde ser concluído.");
  }
  const payload: unknown = await response.json().catch(() => null);
  const object = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  const accessToken =
    object && "access_token" in object && typeof object.access_token === "string"
      ? object.access_token
      : null;
  const userId =
    object && "user_id" in object && (typeof object.user_id === "string" || typeof object.user_id === "number")
      ? String(object.user_id)
      : null;
  if (!accessToken || !userId) {
    throw new MetaLinkError("META_RESPONSE_INVALID", "A Meta retornou uma resposta inválida.");
  }
  return { accessToken, userId };
}

export async function fetchOAuthInstagramIdentity(input: {
  accessToken: string;
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}): Promise<{ id: string; username: string }> {
  const request = input.fetch ?? fetch;
  const response = await request(
    `${metaGraphBase(input.environment)}/me?fields=id,username`,
    { headers: { authorization: `Bearer ${input.accessToken}` } },
  ).catch(() => null);
  if (!response || response.status >= 500 || response.status === 429) {
    throw new MetaLinkError("META_TEMPORARY_ERROR", "A Meta está temporariamente indisponível.");
  }
  if (!response.ok) {
    throw new MetaLinkError("META_AUTH_INVALID", "A autorização do Instagram é inválida.");
  }
  const payload: unknown = await response.json().catch(() => null);
  const object = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  const id = object && "id" in object && typeof object.id === "string" ? object.id : null;
  const username = object && "username" in object && typeof object.username === "string"
    ? object.username
    : null;
  if (!id || !username) {
    throw new MetaLinkError("META_RESPONSE_INVALID", "A Meta retornou uma resposta inválida.");
  }
  return { id, username: normalizeInstagramHandle(username) };
}
