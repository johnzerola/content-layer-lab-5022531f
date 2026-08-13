import { describe, expect, it } from "vitest";
import { safeRemoteUrl } from "@/lib/remote-url";

describe("remote media URL validation", () => {
  it("accepts plain public HTTP URLs", () => {
    expect(safeRemoteUrl("https://cdn.example.com/video.mp4")?.hostname).toBe("cdn.example.com");
  });

  it.each([
    "http://127.0.0.1/video.mp4",
    "http://10.0.0.1/video.mp4",
    "http://169.254.169.254/latest/meta-data",
    "http://user:password@example.com/video.mp4",
    "file:///etc/passwd",
  ])("rejects unsafe URL %s", (url) => {
    expect(safeRemoteUrl(url)).toBeNull();
  });
});
