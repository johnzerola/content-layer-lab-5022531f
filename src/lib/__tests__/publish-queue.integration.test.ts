import { describe, expect, it, vi } from "vitest";
import { runPublishQueue, type ClaimedPost, type PostUpdate, type QueueDependencies } from "@/lib/publish-queue.server";
import type { PublishResult } from "@/lib/publish.server";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function duePost(overrides: Partial<ClaimedPost> = {}): ClaimedPost {
  return {
    id: "post-1",
    user_id: "user-1",
    account_id: "account-1",
    kind: "reels",
    caption: "caption",
    video_url: "https://expired.example/old-signed-url",
    video_path: "user-1/video.mp4",
    attempts: 1,
    ...overrides,
  };
}

function dependencies(posts: ClaimedPost[], publishResult: PublishResult) {
  const updates: Array<{ postId: string; lockId: string; update: PostUpdate }> = [];
  const claimed = new Set<string>();
  const createSignedUrl = vi.fn(async () => "https://storage.example/fresh-signed-url");
  const publish = vi.fn(async () => publishResult);
  const deps: QueueDependencies = {
    claim: async (_lockId, limit) => {
      const available = posts.filter((post) => !claimed.has(post.id)).slice(0, limit);
      available.forEach((post) => claimed.add(post.id));
      return available;
    },
    loadAccount: async () => ({
      id: "account-1",
      user_id: "user-1",
      platform: "instagram",
      username: "channel",
      provider: "meta",
      provider_account_id: "ig-1",
    }),
    loadConnection: async () => null,
    createSignedUrl,
    publish,
    updateClaimedPost: async (postId, lockId, update) => {
      updates.push({ postId, lockId, update });
    },
    now: () => new Date(NOW),
    log: () => undefined,
  };
  return { deps, updates, createSignedUrl, publish };
}

const options = { lockId: "lock-1", limit: 10, lockTimeoutSeconds: 900, maxAttempts: 5 };

describe("publishing queue integration", () => {
  it("claims a due post, regenerates its signed URL, publishes and stores success", async () => {
    const fixture = dependencies([duePost()], {
      ok: true,
      permalink: "https://instagram.example/post",
      providerPostId: "provider-post-1",
    });

    const summary = await runPublishQueue(fixture.deps, options);

    expect(summary).toEqual({ processed: 1, published: 1, retrying: 0, failed: 0 });
    expect(fixture.createSignedUrl).toHaveBeenCalledWith("user-1/video.mp4", 21_600);
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://storage.example/fresh-signed-url", accountId: "account-1" }),
    );
    expect(fixture.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ videoUrl: "https://expired.example/old-signed-url" }),
    );
    expect(fixture.updates[0]?.update).toMatchObject({
      status: "publicado",
      provider_post_id: "provider-post-1",
      lock_id: null,
    });
  });

  it("schedules a temporary failure for a future retry", async () => {
    const fixture = dependencies([duePost({ attempts: 2 })], {
      ok: false,
      code: "PROVIDER_TEMPORARY_ERROR",
      retryable: true,
      error: "temporary",
    });

    const summary = await runPublishQueue(fixture.deps, options);

    expect(summary).toEqual({ processed: 1, published: 0, retrying: 1, failed: 0 });
    expect(fixture.updates[0]?.update).toMatchObject({
      status: "agendado",
      error_code: "PROVIDER_TEMPORARY_ERROR",
      next_attempt_at: "2026-08-14T12:01:00.000Z",
      lock_id: null,
    });
  });

  it("allows only one simultaneous dispatcher to publish the claimed post", async () => {
    const fixture = dependencies([duePost()], { ok: true });
    const [first, second] = await Promise.all([
      runPublishQueue(fixture.deps, { ...options, lockId: "lock-a" }),
      runPublishQueue(fixture.deps, { ...options, lockId: "lock-b" }),
    ]);

    expect(first.processed + second.processed).toBe(1);
    expect(fixture.publish).toHaveBeenCalledTimes(1);
    expect(fixture.updates).toHaveLength(1);
  });

  it("marks the last temporary attempt as exhausted instead of retrying forever", async () => {
    const fixture = dependencies([duePost({ attempts: 5 })], {
      ok: false,
      code: "PROVIDER_TEMPORARY_ERROR",
      retryable: true,
      error: "still temporary",
    });

    const summary = await runPublishQueue(fixture.deps, options);

    expect(summary.failed).toBe(1);
    expect(fixture.updates[0]?.update).toMatchObject({
      status: "falhou",
      error_code: "RETRY_EXHAUSTED",
      next_attempt_at: null,
    });
  });

  it("does not call the publisher when Storage cannot create the signed URL", async () => {
    const fixture = dependencies([duePost()], { ok: true });
    fixture.deps.createSignedUrl = async () => {
      throw new Error("storage unavailable");
    };

    const summary = await runPublishQueue(fixture.deps, options);

    expect(summary.failed).toBe(1);
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.updates[0]?.update).toMatchObject({ status: "falhou", error_code: "MEDIA_NOT_FOUND" });
  });

  it("uses an explicit connected Meta connection instead of the legacy account provider", async () => {
    const fixture = dependencies([duePost()], { ok: true });
    fixture.deps.loadAccount = async () => ({
      id: "account-1",
      user_id: "user-1",
      platform: "instagram",
      username: "madereiracarvalhos",
      provider: "pending",
      provider_account_id: null,
    });
    fixture.deps.loadConnection = async () => ({
      id: "connection-1",
      provider: "meta",
      provider_account_id: "ig-validated",
      status: "conectado",
      expires_at: null,
    });
    fixture.deps.loadProviderAccessToken = async () => "per-account-token";

    await runPublishQueue(fixture.deps, options);

    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "meta",
        providerAccountId: "ig-validated",
        providerAccessToken: "per-account-token",
      }),
    );
  });

  it("never lets a pending explicit connection fall through to a global provider", async () => {
    const fixture = dependencies([duePost()], { ok: true });
    fixture.deps.loadConnection = async () => ({
      id: "connection-1",
      provider: "pending",
      provider_account_id: null,
      status: "aguardando_configuracao",
      expires_at: null,
    });

    const summary = await runPublishQueue(fixture.deps, options);

    expect(summary.failed).toBe(1);
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.updates[0]?.update).toMatchObject({ error_code: "ACCOUNT_NOT_CONNECTED" });
  });
});
