export type PostKind = "reels" | "feed" | "stories";
export type SocialPlatform = "instagram" | "facebook" | "tiktok" | "youtube";
export type SocialProvider = "ayrshare" | "meta" | "tiktok" | "youtube" | "pending";

export type PublishErrorCode =
  | "AUTH_EXPIRED"
  | "AUTH_INVALID"
  | "ACCOUNT_NOT_CONNECTED"
  | "ACCOUNT_MISMATCH"
  | "CAPABILITY_UNAVAILABLE"
  | "MEDIA_NOT_FOUND"
  | "MEDIA_INVALID"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TEMPORARY_ERROR"
  | "PROVIDER_PERMANENT_ERROR"
  | "RETRY_EXHAUSTED"
  | "DATABASE_ERROR";

export type PlatformCapabilities = {
  canPublishReels: boolean;
  canPublishStories: boolean;
  canPublishFeed: boolean;
  canPublishShorts: boolean;
  canRefreshToken: boolean;
};

export const PLATFORM_CAPABILITIES: Record<SocialPlatform, PlatformCapabilities> = {
  instagram: {
    canPublishReels: true,
    canPublishStories: true,
    canPublishFeed: true,
    canPublishShorts: false,
    canRefreshToken: false,
  },
  facebook: {
    canPublishReels: true,
    canPublishStories: false,
    canPublishFeed: true,
    canPublishShorts: false,
    canRefreshToken: false,
  },
  tiktok: {
    canPublishReels: false,
    canPublishStories: false,
    canPublishFeed: false,
    canPublishShorts: false,
    canRefreshToken: false,
  },
  youtube: {
    canPublishReels: false,
    canPublishStories: false,
    canPublishFeed: false,
    canPublishShorts: true,
    canRefreshToken: true,
  },
};

export function canPublish(platform: string, kind: PostKind): boolean {
  const capabilities = PLATFORM_CAPABILITIES[platform as SocialPlatform];
  if (!capabilities) return false;
  if (kind === "reels") return capabilities.canPublishReels;
  if (kind === "stories") return capabilities.canPublishStories;
  return capabilities.canPublishFeed;
}

export function retryDelaySeconds(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(15 * 60, 30 * 2 ** (safeAttempt - 1));
}

export function isRetryableCode(code: PublishErrorCode): boolean {
  return code === "PROVIDER_RATE_LIMIT" || code === "PROVIDER_TEMPORARY_ERROR" || code === "DATABASE_ERROR";
}
