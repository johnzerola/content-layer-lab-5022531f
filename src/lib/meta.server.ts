export const DEFAULT_META_GRAPH_VERSION = "v26.0";

export type MetaCredentials = {
  accessToken: string;
  igUserId: string;
};

export function metaGraphVersion(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment["META_GRAPH_VERSION"]?.trim();
  return configured && /^v\d+\.\d+$/.test(configured) ? configured : DEFAULT_META_GRAPH_VERSION;
}

export function metaGraphBase(environment: NodeJS.ProcessEnv = process.env): string {
  return `https://graph.instagram.com/${metaGraphVersion(environment)}`;
}

export function globalMetaCredentials(
  environment: NodeJS.ProcessEnv = process.env,
): MetaCredentials | null {
  const accessToken = environment["META_ACCESS_TOKEN"]?.trim();
  const igUserId = environment["META_IG_USER_ID"]?.trim();
  return accessToken && igUserId ? { accessToken, igUserId } : null;
}
