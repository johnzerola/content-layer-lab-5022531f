import { beforeEach, describe, expect, it, vi } from "vitest";

describe("CleanerIA signed URLs", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env["CLEANER_WORKER_SECRET"] = "a".repeat(48);
    process.env["CLEANER_WORKER_URL"] = "https://cleaner.example.com";
    process.env["CLEANER_WORKER_PUBLIC_URL"] = "https://cleaner.example.com";
  });

  it("creates operation-scoped v2 tokens", async () => {
    const { jobToken } = await import("@/lib/cleaner.server");
    const token = jobToken("00000000-0000-4000-8000-000000000001", "upload", 60);
    expect(token).toMatch(/^v2\.[0-9a-f-]{36}\.\d+\.upload\.[0-9a-f]{64}$/);
  });

  it("signs only result URLs from the configured worker", async () => {
    const { workerResultUrl } = await import("@/lib/cleaner.server");
    const result = workerResultUrl("/v1/jobs/00000000-0000-4000-8000-000000000001/result");
    expect(result).toContain("https://cleaner.example.com/v1/jobs/");
    expect(result).toContain("token=v2.");
    expect(workerResultUrl("https://evil.example.com/video.mp4")).toBeNull();
  });

  it("creates and verifies short-lived media proxy tickets", async () => {
    const { mediaProxyTicket, verifyMediaProxyTicket } = await import("@/lib/cleaner.server");
    const ticket = mediaProxyTicket("https://cdn.example.com/video.mp4", {
      "user-agent": "test-agent",
      cookie: "secret-cookie",
    });
    expect(verifyMediaProxyTicket(ticket)).toEqual({
      url: "https://cdn.example.com/video.mp4",
      headers: { "user-agent": "test-agent" },
    });
    expect(verifyMediaProxyTicket(`${ticket}bad`)).toBeNull();
  });
});
