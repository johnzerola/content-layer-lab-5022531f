import { describe, expect, it, vi } from "vitest";
import {
  createInstagramOAuthState,
  exchangeInstagramAuthorizationCode,
  fetchOAuthInstagramIdentity,
  instagramAuthorizationUrl,
  verifyInstagramOAuthState,
} from "@/lib/meta-oauth.server";

const environment = {
  META_APP_ID: "app-123",
  META_APP_SECRET: "server-only-secret",
  META_REDIRECT_URI: "https://app.example/integracoes/instagram/callback",
  META_GRAPH_VERSION: "v26.0",
} as NodeJS.ProcessEnv;

describe("Instagram OAuth", () => {
  it("creates the official authorization URL with required publishing scopes", () => {
    const url = new URL(instagramAuthorizationUrl("user-123", environment));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("app-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/integracoes/instagram/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([
      "instagram_business_basic",
      "instagram_business_content_publish",
    ]);
    expect(url.toString()).not.toContain("server-only-secret");
  });

  it("binds state to the authenticated user and expiry", () => {
    const state = createInstagramOAuthState("user-123", environment, 1_000);
    expect(() => verifyInstagramOAuthState(state, "user-123", environment, 2_000)).not.toThrow();
    expect(() => verifyInstagramOAuthState(state, "other-user", environment, 2_000)).toThrow();
    expect(() => verifyInstagramOAuthState(state, "user-123", environment, 700_000)).toThrow();
    expect(() => verifyInstagramOAuthState(`${state}x`, "user-123", environment, 2_000)).toThrow();
  });

  it("exchanges the code server-side as form data", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "oauth-token", user_id: 12345 }), { status: 200 }),
    );
    await expect(
      exchangeInstagramAuthorizationCode({ code: "authorization-code#_", environment, fetch: request }),
    ).resolves.toEqual({ accessToken: "oauth-token", userId: "12345" });

    expect(request).toHaveBeenCalledWith(
      "https://api.instagram.com/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    );
    const body = request.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(String(body)).toContain("code=authorization-code");
    expect(String(body)).toContain("client_secret=server-only-secret");
  });

  it("validates the authorized identity with Bearer authentication", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "12345", username: "Minha.Conta" }), { status: 200 }),
    );
    await expect(
      fetchOAuthInstagramIdentity({ accessToken: "oauth-token", environment, fetch: request }),
    ).resolves.toEqual({ id: "12345", username: "minha.conta" });
    expect(request).toHaveBeenCalledWith(
      "https://graph.instagram.com/v26.0/me?fields=id,username",
      { headers: { authorization: "Bearer oauth-token" } },
    );
  });
});
