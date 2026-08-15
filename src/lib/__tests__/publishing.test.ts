import { afterEach, describe, expect, it, vi } from "vitest";
import { activeProvider, publish } from "@/lib/publish.server";
import { canPublish, isRetryableCode, retryDelaySeconds } from "@/lib/publishing";
import { validCronSecret } from "@/lib/publish-auth.server";

const originalEnvironment = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
});

const metaInput = {
  kind: "reels" as const,
  caption: "A test reel",
  videoUrl: "https://media.example.test/video.mp4",
  username: "channel",
  platform: "instagram",
  provider: "meta" as const,
  providerAccountId: "instagram-user-id",
};

const metaToken = "test-meta-access-token";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function configureMeta(version?: string) {
  process.env["META_ACCESS_TOKEN"] = metaToken;
  process.env["META_IG_USER_ID"] = "instagram-user-id";
  if (version === undefined) delete process.env["META_GRAPH_VERSION"];
  else process.env["META_GRAPH_VERSION"] = version;
}

function expectBearer(requests: Parameters<typeof fetch>[]) {
  for (const [, init] of requests) {
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${metaToken}`);
  }
}

describe("scheduler authentication", () => {
  const secret = "a-secure-cron-secret-with-at-least-32-characters";

  it("rejects missing and invalid credentials", () => {
    expect(validCronSecret(null, secret)).toBe(false);
    expect(validCronSecret("Bearer wrong", secret)).toBe(false);
  });

  it("accepts the exact bearer secret", () => {
    expect(validCronSecret(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects weak server configuration", () => {
    expect(validCronSecret("Bearer short", "short")).toBe(false);
  });
});

describe("publishing policy", () => {
  it("uses bounded progressive retry delays", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(99)).toBe(900);
  });

  it("retries only temporary normalized failures", () => {
    expect(isRetryableCode("PROVIDER_RATE_LIMIT")).toBe(true);
    expect(isRetryableCode("PROVIDER_TEMPORARY_ERROR")).toBe(true);
    expect(isRetryableCode("AUTH_INVALID")).toBe(false);
  });

  it("does not advertise unimplemented platforms", () => {
    expect(canPublish("instagram", "reels")).toBe(true);
    expect(canPublish("instagram", "feed")).toBe(true);
    expect(canPublish("tiktok", "reels")).toBe(false);
    expect(canPublish("youtube", "reels")).toBe(false);
    expect(canPublish("facebook", "stories")).toBe(false);
  });

  it("selects only a configured requested adapter", () => {
    delete process.env["AYRSHARE_API_KEY"];
    delete process.env["META_ACCESS_TOKEN"];
    delete process.env["META_IG_USER_ID"];
    expect(activeProvider("meta")).toBeNull();
    process.env["META_ACCESS_TOKEN"] = "token";
    process.env["META_IG_USER_ID"] = "account";
    expect(activeProvider("meta")).toBe("meta");
    expect(activeProvider("ayrshare")).toBeNull();
  });

  it("rejects unsupported platforms without calling an external API", async () => {
    const result = await publish({
      kind: "reels",
      caption: "",
      videoUrl: "https://example.test/video.mp4",
      username: "channel",
      platform: "tiktok",
      provider: "tiktok",
    });
    expect(result).toMatchObject({ ok: false, code: "CAPABILITY_UNAVAILABLE", retryable: false });
  });

  it("prevents a Meta credential from targeting a different account", async () => {
    process.env["META_ACCESS_TOKEN"] = "token";
    process.env["META_IG_USER_ID"] = "expected-account";
    const result = await publish({
      kind: "reels",
      caption: "",
      videoUrl: "https://example.test/video.mp4",
      username: "channel",
      platform: "instagram",
      provider: "meta",
      providerAccountId: "another-account",
    });
    expect(result).toMatchObject({ ok: false, code: "ACCOUNT_MISMATCH", retryable: false });
  });
});

describe("Meta Instagram Login publisher", () => {
  it("publishes a Reel through graph.instagram.com with the configured version and Bearer auth", async () => {
    configureMeta("v25.0");
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-id" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "published-id" }));

    await expect(publish(metaInput)).resolves.toEqual({ ok: true, providerPostId: "published-id" });

    const requests = fetchMock.mock.calls;
    expect(requests.map(([url]) => String(url))).toEqual([
      "https://graph.instagram.com/v25.0/instagram-user-id/media",
      "https://graph.instagram.com/v25.0/container-id?fields=status_code",
      "https://graph.instagram.com/v25.0/instagram-user-id/media_publish",
    ]);
    expectBearer(requests);

    const createBody = JSON.parse(String(requests[0]?.[1]?.body));
    expect(createBody).toEqual({
      media_type: "REELS",
      video_url: metaInput.videoUrl,
      caption: metaInput.caption,
    });
    expect(JSON.parse(String(requests[2]?.[1]?.body))).toEqual({ creation_id: "container-id" });
    for (const [url, init] of requests) {
      expect(String(url)).not.toContain(metaToken);
      expect(String(init?.body ?? "")).not.toContain(metaToken);
      expect(String(url)).not.toContain("access_token");
      expect(String(init?.body ?? "")).not.toContain("access_token");
    }
  });

  it("uses v26.0 as fallback and omits caption when creating a Story", async () => {
    configureMeta("not-a-version");
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, { id: "story-container" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "story-id" }));

    const result = await publish({ ...metaInput, kind: "stories", caption: "must not be sent" });

    expect(result).toEqual({ ok: true, providerPostId: "story-id" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://graph.instagram.com/v26.0/instagram-user-id/media",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      media_type: "STORIES",
      video_url: metaInput.videoUrl,
    });
    expectBearer(fetchMock.mock.calls);
  });

  it("uses v26.0 when META_GRAPH_VERSION is absent", async () => {
    configureMeta();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(401, { error: "denied" }));

    await publish(metaInput);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://graph.instagram.com/v26.0/instagram-user-id/media",
    );
  });

  it("returns a permanent media error when container processing reports ERROR", async () => {
    configureMeta();
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-id" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "ERROR" }));

    await expect(publish(metaInput)).resolves.toMatchObject({
      ok: false,
      code: "MEDIA_INVALID",
      retryable: false,
    });
  });

  it("returns a retryable temporary error when container polling times out", async () => {
    configureMeta();
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) =>
        String(url).endsWith("/media")
          ? jsonResponse(200, { id: "container-id" })
          : jsonResponse(200, { status_code: "IN_PROGRESS" }),
      );

    await expect(publish(metaInput)).resolves.toMatchObject({
      ok: false,
      code: "PROVIDER_TEMPORARY_ERROR",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  it.each([401, 403])(
    "classifies HTTP %i as a non-retryable authentication error",
    async (status) => {
      configureMeta();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        jsonResponse(status, { error: "denied" }),
      );

      await expect(publish(metaInput)).resolves.toMatchObject({
        ok: false,
        code: "AUTH_INVALID",
        retryable: false,
      });
    },
  );

  it("classifies HTTP 429 as retryable rate limiting", async () => {
    configureMeta();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(429, { error: "limited" }));

    await expect(publish(metaInput)).resolves.toMatchObject({
      ok: false,
      code: "PROVIDER_RATE_LIMIT",
      retryable: true,
    });
  });

  it("classifies HTTP 5xx as a retryable provider error", async () => {
    configureMeta();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse(503, { error: "unavailable" }),
    );

    await expect(publish(metaInput)).resolves.toMatchObject({
      ok: false,
      code: "PROVIDER_TEMPORARY_ERROR",
      retryable: true,
    });
  });
});
