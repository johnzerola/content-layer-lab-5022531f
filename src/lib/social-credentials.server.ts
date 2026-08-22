import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { MetaLinkError } from "@/lib/social-linking.server";
import { refreshLongLivedInstagramToken } from "@/lib/meta-oauth.server";

const CIPHER_VERSION = "v1";

function encryptionKey(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = environment["SOCIAL_TOKEN_ENCRYPTION_KEY"]?.trim();
  if (!secret || secret.length < 32) {
    throw new MetaLinkError(
      "SERVER_CONFIG_MISSING",
      "A criptografia das conexões sociais ainda não está configurada.",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSocialToken(
  token: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (!token) throw new MetaLinkError("META_AUTH_INVALID", "Token social inválido.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(environment), nonce);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [CIPHER_VERSION, nonce.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSocialToken(
  encrypted: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const [version, nonceValue, tagValue, ciphertextValue, extra] = encrypted.split(".");
  if (version !== CIPHER_VERSION || !nonceValue || !tagValue || !ciphertextValue || extra) {
    throw new Error("Invalid encrypted social credential");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(environment),
    Buffer.from(nonceValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function resolveMetaAccessToken(input: {
  ciphertext: string;
  expiresAt: string;
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: Date;
  persistRefresh: (ciphertext: string, expiresAt: string) => Promise<void>;
}): Promise<string> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    throw new MetaLinkError("META_AUTH_INVALID", "A conexão Instagram expirou.");
  }
  const accessToken = decryptSocialToken(input.ciphertext, input.environment);
  const refreshThreshold = 7 * 24 * 60 * 60 * 1000;
  if (expiresAt.getTime() - now.getTime() > refreshThreshold) return accessToken;

  const refreshed = await refreshLongLivedInstagramToken({
    accessToken,
    ...(input.fetch ? { fetch: input.fetch } : {}),
    now: now.getTime(),
  });
  const ciphertext = encryptSocialToken(refreshed.accessToken, input.environment);
  await input.persistRefresh(ciphertext, refreshed.expiresAt.toISOString());
  return refreshed.accessToken;
}
