import { afterEach, describe, expect, it } from "vitest";
import { activeProvider, publish } from "@/lib/publish.server";
import { canPublish, isRetryableCode, retryDelaySeconds } from "@/lib/publishing";
import { validCronSecret } from "@/lib/publish-auth.server";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

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
