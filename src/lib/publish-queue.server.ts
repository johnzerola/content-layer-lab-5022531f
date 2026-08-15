import type { PublishInput, PublishResult } from "@/lib/publish.server";
import {
  canPublish,
  retryDelaySeconds,
  type PostKind,
  type PublishErrorCode,
  type SocialProvider,
} from "@/lib/publishing";

export type ClaimedPost = {
  id: string;
  user_id: string;
  account_id: string | null;
  kind: string;
  caption: string;
  video_url: string | null;
  video_path: string | null;
  attempts: number;
  idempotency_key?: string | null;
};

export type PublishingAccount = {
  id: string;
  user_id: string;
  platform: string;
  username: string;
  provider: string;
  provider_account_id: string | null;
};

export type PublishingConnection = {
  provider: string;
  provider_account_id: string | null;
  status: string;
  expires_at: string | null;
};

export type PostUpdate = {
  status?: string;
  published_at?: string | null;
  permalink?: string | null;
  provider_post_id?: string | null;
  deleted_storage_at?: string | null;
  error?: string | null;
  error_code?: string | null;
  lock_id?: string | null;
  locked_at?: string | null;
  next_attempt_at?: string | null;
};

export type QueueDependencies = {
  claim: (lockId: string, limit: number, lockTimeoutSeconds: number, maxAttempts: number) => Promise<ClaimedPost[]>;
  loadAccount: (accountId: string) => Promise<PublishingAccount | null>;
  loadConnection: (accountId: string, userId: string) => Promise<PublishingConnection | null>;
  createSignedUrl: (videoPath: string, expiresInSeconds: number) => Promise<string>;
  removeStorageObject?: (videoPath: string) => Promise<void>;
  publish: (input: PublishInput) => Promise<PublishResult>;
  updateClaimedPost: (postId: string, lockId: string, update: PostUpdate) => Promise<void>;
  now: () => Date;
  log: (entry: Record<string, unknown>) => void;
};

export type QueueResult = { processed: number; published: number; retrying: number; failed: number };

function provider(value: string): SocialProvider {
  return value === "ayrshare" || value === "meta" || value === "tiktok" || value === "youtube"
    ? value
    : "pending";
}

function failure(code: PublishErrorCode, error: string, retryable = false): PublishResult {
  return { ok: false, code, error, retryable };
}

async function publishClaimedPost(post: ClaimedPost, deps: QueueDependencies): Promise<PublishResult> {
  if (!post.account_id) return failure("ACCOUNT_MISMATCH", "O agendamento não possui uma conta válida.");
  const account = await deps.loadAccount(post.account_id);
  if (!account || account.user_id !== post.user_id) {
    return failure("ACCOUNT_MISMATCH", "A conta selecionada não pertence ao agendamento.");
  }

  const connection = await deps.loadConnection(account.id, post.user_id);
  if (connection?.expires_at && new Date(connection.expires_at) <= deps.now()) {
    return failure("AUTH_EXPIRED", "A conexão social expirou.");
  }
  if (connection && connection.status !== "conectado") {
    return failure("ACCOUNT_NOT_CONNECTED", "A conta social exige atenção antes de publicar.");
  }
  if (!canPublish(account.platform, post.kind as PostKind)) {
    return failure("CAPABILITY_UNAVAILABLE", "A plataforma não suporta este formato de publicação.");
  }

  let videoUrl: string;
  if (post.video_path) {
    try {
      videoUrl = await deps.createSignedUrl(post.video_path, 6 * 60 * 60);
    } catch {
      return failure("MEDIA_NOT_FOUND", "O arquivo de vídeo não está disponível.");
    }
  } else if (post.video_url) {
    // Compatibility only for records created before video_path existed.
    videoUrl = post.video_url;
  } else {
    return failure("MEDIA_NOT_FOUND", "O agendamento não possui um vídeo.");
  }

  return deps.publish({
    accountId: account.id,
    kind: post.kind as PostKind,
    caption: post.caption,
    videoUrl,
    username: account.username,
    platform: account.platform,
    provider: provider(connection?.provider ?? account.provider),
    providerAccountId: connection?.provider_account_id ?? account.provider_account_id,
    idempotencyKey: post.idempotency_key ?? post.id,
  });
}

export async function runPublishQueue(
  deps: QueueDependencies,
  options: { lockId: string; limit: number; lockTimeoutSeconds: number; maxAttempts: number },
): Promise<QueueResult> {
  const due = await deps.claim(options.lockId, options.limit, options.lockTimeoutSeconds, options.maxAttempts);
  const summary: QueueResult = { processed: due.length, published: 0, retrying: 0, failed: 0 };

  for (const post of due) {
    const startedAt = Date.now();
    let result: PublishResult;
    try {
      result = await publishClaimedPost(post, deps);
    } catch {
      result = failure("DATABASE_ERROR", "Falha temporária durante a publicação.", true);
    }

    if (result.ok) {
      let deletedStorageAt: string | null = null;
      if (post.video_path && deps.removeStorageObject) {
        try {
          await deps.removeStorageObject(post.video_path);
          deletedStorageAt = deps.now().toISOString();
        } catch {
          deps.log({
            event: "publish_storage_cleanup_failed",
            postId: post.id,
            path: post.video_path,
          });
        }
      }
      await deps.updateClaimedPost(post.id, options.lockId, {
        status: "publicado",
        published_at: deps.now().toISOString(),
        permalink: result.permalink ?? null,
        provider_post_id: result.providerPostId ?? null,
        deleted_storage_at: deletedStorageAt,
        error: null,
        error_code: null,
        lock_id: null,
        locked_at: null,
        next_attempt_at: null,
      });
      summary.published++;
    } else {
      const shouldRetry = result.retryable && post.attempts < options.maxAttempts;
      await deps.updateClaimedPost(post.id, options.lockId, {
        status: shouldRetry ? "agendado" : "falhou",
        error: result.error.slice(0, 500),
        error_code: shouldRetry || result.code !== "PROVIDER_TEMPORARY_ERROR" ? result.code : "RETRY_EXHAUSTED",
        next_attempt_at: shouldRetry
          ? new Date(deps.now().getTime() + retryDelaySeconds(post.attempts) * 1000).toISOString()
          : null,
        lock_id: null,
        locked_at: null,
      });
      if (shouldRetry) summary.retrying++;
      else summary.failed++;
    }

    deps.log({
      event: "publish_attempt_finished",
      postId: post.id,
      accountId: post.account_id,
      attempt: post.attempts,
      durationMs: Date.now() - startedAt,
      outcome: result.ok ? "published" : result.code,
    });
  }
  return summary;
}
