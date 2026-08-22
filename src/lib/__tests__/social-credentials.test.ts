import { describe, expect, it, vi } from "vitest";
import { decryptSocialToken, encryptSocialToken, resolveMetaAccessToken } from "@/lib/social-credentials.server";

const environment = { SOCIAL_TOKEN_ENCRYPTION_KEY: "a-secure-key-with-at-least-32-characters" } as NodeJS.ProcessEnv;

describe("per-connection social credentials", () => {
  it("encrypts authenticated data without storing the token in plaintext", () => {
    const encrypted = encryptSocialToken("private-user-token", environment);
    expect(encrypted).not.toContain("private-user-token");
    expect(decryptSocialToken(encrypted, environment)).toBe("private-user-token");
    expect(() => decryptSocialToken(encrypted, { SOCIAL_TOKEN_ENCRYPTION_KEY: "another-secure-key-with-32-characters" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("refreshes a token near expiry and persists only encrypted data", async () => {
    const ciphertext = encryptSocialToken("old-token", environment);
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "new-token", expires_in: 5_184_000 }), { status: 200 }),
    );
    const persistRefresh = vi.fn().mockResolvedValue(undefined);
    await expect(resolveMetaAccessToken({
      ciphertext,
      expiresAt: "2026-08-25T00:00:00.000Z",
      environment,
      fetch: request,
      now: new Date("2026-08-22T00:00:00.000Z"),
      persistRefresh,
    })).resolves.toBe("new-token");
    const persistedCiphertext = String(persistRefresh.mock.calls[0]?.[0]);
    expect(persistedCiphertext).not.toContain("new-token");
    expect(decryptSocialToken(persistedCiphertext, environment)).toBe("new-token");
  });
});
