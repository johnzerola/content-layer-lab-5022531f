import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runPublishQueue,
  type PublishingAccount,
  type PublishingConnection,
} from "@/lib/publish-queue.server";
import { publish } from "@/lib/publish.server";
import {
  linkConfiguredInstagramAccount,
  type LinkedSocialAccount,
} from "@/lib/social-linking.server";

const originalEnvironment = { ...process.env };

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnvironment };
});

describe("authenticated Meta linking to scheduled publishing", () => {
  it("links the validated account, creates its connection, and selects publishMeta", async () => {
    process.env["META_ACCESS_TOKEN"] = "integration-meta-token";
    process.env["META_IG_USER_ID"] = "ig-validated";
    process.env["META_GRAPH_VERSION"] = "v26.0";
    delete process.env["AYRSHARE_API_KEY"];

    let storedAccount: PublishingAccount | null = null;
    let storedConnection: PublishingConnection | null = null;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(200, { id: "ig-validated", username: "madereiracarvalhos" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { id: "container-id" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "published-id" }));
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    await linkConfiguredInstagramAccount({
      userId: "user-1",
      requestedHandle: "@madereiracarvalhos",
      credentials: { accessToken: "integration-meta-token", igUserId: "ig-validated" },
      fetch: fetchMock,
      persist: async ({ userId, handle, providerAccountId }) => {
        storedAccount = {
          id: "account-1",
          user_id: userId,
          platform: "instagram",
          username: handle,
          provider: "meta",
          provider_account_id: providerAccountId,
        };
        storedConnection = {
          provider: "meta",
          provider_account_id: providerAccountId,
          status: "conectado",
          expires_at: null,
        };
        return {
          ...storedAccount,
          display_name: null,
          avatar_url: null,
          status: "conectado",
          created_at: "2026-08-15T00:00:00.000Z",
        } as LinkedSocialAccount;
      },
    });

    const updateClaimedPost = vi.fn();
    const summary = await runPublishQueue(
      {
        claim: async () => [
          {
            id: "post-1",
            user_id: "user-1",
            account_id: "account-1",
            kind: "reels",
            caption: "caption",
            video_url: null,
            video_path: "user-1/video.mp4",
            attempts: 1,
          },
        ],
        loadAccount: async () => storedAccount,
        loadConnection: async () => storedConnection,
        createSignedUrl: async () => "https://media.example.test/fresh-video.mp4",
        publish,
        updateClaimedPost,
        now: () => new Date("2026-08-15T12:00:00.000Z"),
        log: () => undefined,
      },
      { lockId: "lock-1", limit: 10, lockTimeoutSeconds: 900, maxAttempts: 5 },
    );

    expect(summary).toEqual({ processed: 1, published: 1, retrying: 0, failed: 0 });
    expect(updateClaimedPost).toHaveBeenCalledWith(
      "post-1",
      "lock-1",
      expect.objectContaining({ status: "publicado", provider_post_id: "published-id" }),
    );
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://graph.instagram.com/v26.0/ig-validated?fields=id,username",
      "https://graph.instagram.com/v26.0/ig-validated/media",
      "https://graph.instagram.com/v26.0/container-id?fields=status_code",
      "https://graph.instagram.com/v26.0/ig-validated/media_publish",
    ]);
  });

  it("keeps an explicitly configured Ayrshare account on Ayrshare", async () => {
    process.env["AYRSHARE_API_KEY"] = "ayrshare-test-key";
    process.env["META_ACCESS_TOKEN"] = "meta-test-token";
    process.env["META_IG_USER_ID"] = "ig-validated";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(200, {
          postIds: [{ id: "ayrshare-post", postUrl: "https://instagram.test/post" }],
        }),
      );

    const result = await publish({
      kind: "reels",
      caption: "caption",
      videoUrl: "https://media.example.test/video.mp4",
      username: "channel",
      platform: "instagram",
      provider: "ayrshare",
      providerAccountId: "ayrshare-profile",
    });

    expect(result).toMatchObject({ ok: true, providerPostId: "ayrshare-post" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.ayrshare.com/api/post");
  });
});
