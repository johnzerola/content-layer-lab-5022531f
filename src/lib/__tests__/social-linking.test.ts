import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configuredMetaCredentials,
  fetchConfiguredMetaIdentity,
  linkConfiguredInstagramAccount,
  MetaLinkError,
  normalizeInstagramHandle,
  type LinkedSocialAccount,
} from "@/lib/social-linking.server";

const credentials = { accessToken: "secret-test-token", igUserId: "ig-123" };

function response(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function account(overrides: Partial<LinkedSocialAccount> = {}): LinkedSocialAccount {
  return {
    id: "account-1",
    platform: "instagram",
    username: "madereiracarvalhos",
    display_name: null,
    avatar_url: null,
    provider: "meta",
    provider_account_id: "ig-123",
    status: "conectado",
    created_at: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function validFetch(id = "ig-123", username = "madereiracarvalhos") {
  return vi.fn<typeof fetch>().mockImplementation(async () => response(200, { id, username }));
}

afterEach(() => vi.restoreAllMocks());

describe("Instagram handle normalization", () => {
  it.each(["madereiracarvalhos", "@madereiracarvalhos", "  @MadereiraCarvalhos  "])(
    "normalizes %s to the same account",
    (handle) => {
      expect(normalizeInstagramHandle(handle)).toBe("madereiracarvalhos");
    },
  );

  it("rejects malformed handles", () => {
    expect(() => normalizeInstagramHandle("@bad handle!")).toThrow(
      "Informe um @ do Instagram válido.",
    );
  });
});

describe("global Meta credential resolution", () => {
  it("rejects a missing token", () => {
    expect(() => configuredMetaCredentials({ META_IG_USER_ID: "ig-123" })).toThrowError(
      expect.objectContaining({ code: "META_TOKEN_MISSING" }),
    );
  });

  it("rejects a missing Instagram User ID", () => {
    expect(() => configuredMetaCredentials({ META_ACCESS_TOKEN: "token" })).toThrowError(
      expect.objectContaining({ code: "META_IG_ID_MISSING" }),
    );
  });
});

describe("Meta identity validation", () => {
  it.each([401, 403])("sanitizes an invalid authorization returned as HTTP %i", async (status) => {
    await expect(
      fetchConfiguredMetaIdentity(credentials, {
        fetch: vi.fn().mockResolvedValue(response(status, { secret: credentials.accessToken })),
      }),
    ).rejects.toMatchObject({ code: "META_AUTH_INVALID" });
  });

  it("classifies HTTP 429 as temporary rate limiting", async () => {
    await expect(
      fetchConfiguredMetaIdentity(credentials, {
        fetch: vi.fn().mockResolvedValue(response(429, {})),
      }),
    ).rejects.toMatchObject({ code: "META_RATE_LIMIT" });
  });

  it("classifies Meta 5xx and network failures as temporary", async () => {
    await expect(
      fetchConfiguredMetaIdentity(credentials, {
        fetch: vi.fn().mockResolvedValue(response(503, {})),
      }),
    ).rejects.toMatchObject({ code: "META_TEMPORARY_ERROR" });
    await expect(
      fetchConfiguredMetaIdentity(credentials, {
        fetch: vi.fn().mockRejectedValue(new Error("network secret")),
      }),
    ).rejects.toMatchObject({ code: "META_TEMPORARY_ERROR" });
  });

  it("rejects an invalid Meta response", async () => {
    await expect(
      fetchConfiguredMetaIdentity(credentials, {
        fetch: vi.fn().mockResolvedValue(response(200, { id: "ig-123" })),
      }),
    ).rejects.toMatchObject({ code: "META_RESPONSE_INVALID" });
  });

  it("uses Bearer auth without putting the credential in URL, response, error, or logs", async () => {
    const fetchMock = validFetch();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const identity = await fetchConfiguredMetaIdentity(credentials, {
      fetch: fetchMock,
      environment: { META_GRAPH_VERSION: "v26.0" },
    });

    expect(identity).toEqual({ id: "ig-123", username: "madereiracarvalhos" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.instagram.com/v26.0/ig-123?fields=id,username");
    expect(String(url)).not.toContain(credentials.accessToken);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${credentials.accessToken}`,
    );
    expect(JSON.stringify(identity)).not.toContain(credentials.accessToken);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("Meta account linking", () => {
  it("connects a matching account and persists only validated server data", async () => {
    const persist = vi.fn().mockResolvedValue(account());
    const result = await linkConfiguredInstagramAccount({
      userId: "user-1",
      requestedHandle: "@MadereiraCarvalhos",
      credentials,
      fetch: validFetch(),
      persist,
    });

    expect(result.account).toMatchObject({
      provider: "meta",
      provider_account_id: "ig-123",
      status: "conectado",
    });
    expect(persist).toHaveBeenCalledWith({
      userId: "user-1",
      handle: "madereiracarvalhos",
      providerAccountId: "ig-123",
    });
    expect(JSON.stringify(result)).not.toContain(credentials.accessToken);
  });

  it("rejects a different username without persisting", async () => {
    const persist = vi.fn();
    await expect(
      linkConfiguredInstagramAccount({
        userId: "user-1",
        requestedHandle: "anotheraccount",
        credentials,
        fetch: validFetch(),
        persist,
      }),
    ).rejects.toMatchObject({ code: "META_ACCOUNT_MISMATCH" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects an ID different from META_IG_USER_ID without persisting", async () => {
    const persist = vi.fn();
    await expect(
      linkConfiguredInstagramAccount({
        userId: "user-1",
        requestedHandle: "madereiracarvalhos",
        credentials,
        fetch: validFetch("ig-other"),
        persist,
      }),
    ).rejects.toMatchObject({ code: "META_ACCOUNT_MISMATCH" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("requires an authenticated user before calling Meta or persistence", async () => {
    const fetchMock = validFetch();
    const persist = vi.fn();
    await expect(
      linkConfiguredInstagramAccount({
        userId: "",
        requestedHandle: "madereiracarvalhos",
        credentials,
        fetch: fetchMock,
        persist,
      }),
    ).rejects.toMatchObject({ code: "LOGIN_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not hide ownership or provider conflicts returned by persistence", async () => {
    for (const code of ["ACCOUNT_OWNERSHIP_INVALID", "PROVIDER_CONFLICT"] as const) {
      await expect(
        linkConfiguredInstagramAccount({
          userId: "user-1",
          requestedHandle: "madereiracarvalhos",
          credentials,
          fetch: validFetch(),
          persist: async () => {
            throw new MetaLinkError(code, "safe conflict");
          },
        }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("is idempotent and leaves an already connected Meta account connected", async () => {
    const stored = account();
    const persist = vi.fn(async () => stored);
    const input = {
      userId: "user-1",
      requestedHandle: "madereiracarvalhos",
      credentials,
      fetch: validFetch(),
      persist,
    };

    await linkConfiguredInstagramAccount(input);
    await linkConfiguredInstagramAccount(input);

    expect(stored).toMatchObject({
      provider: "meta",
      provider_account_id: "ig-123",
      status: "conectado",
    });
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("keeps one coherent connection under two simultaneous links", async () => {
    const connections = new Map<string, LinkedSocialAccount>();
    const persist = vi.fn(async ({ userId, providerAccountId }) => {
      await Promise.resolve();
      const key = `${userId}:account-1`;
      const stored = connections.get(key) ?? account({ provider_account_id: providerAccountId });
      connections.set(key, stored);
      return stored;
    });
    const input = {
      userId: "user-1",
      requestedHandle: "madereiracarvalhos",
      credentials,
      fetch: validFetch(),
      persist,
    };

    const results = await Promise.all([
      linkConfiguredInstagramAccount(input),
      linkConfiguredInstagramAccount(input),
    ]);

    expect(connections).toHaveLength(1);
    expect(results[0].account).toEqual(results[1].account);
  });
});
