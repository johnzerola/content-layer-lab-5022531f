import { MetaLinkError, type LinkedSocialAccount } from "@/lib/social-linking.server";

type LinkRpc = (name: "link_global_meta_account", args: { p_user_id: string; p_username: string; p_provider_account_id: string }) => PromiseLike<{ data: LinkedSocialAccount[] | null; error: { message: string } | null }>;
type OAuthLinkRpc = (name: "link_meta_oauth_account", args: { p_user_id: string; p_username: string; p_provider_account_id: string; p_access_token_ciphertext: string; p_expires_at: string }) => PromiseLike<{ data: LinkedSocialAccount[] | null; error: { message: string } | null }>;

export async function persistValidatedMetaAccount(rpc: LinkRpc, input: { userId: string; handle: string; providerAccountId: string }): Promise<LinkedSocialAccount> {
  const { data: account, error } = await rpc("link_global_meta_account", { p_user_id: input.userId, p_username: input.handle, p_provider_account_id: input.providerAccountId });
  if (error || !account?.[0]) {
    const message = error?.message ?? "";
    if (message.includes("account ownership mismatch")) throw new MetaLinkError("ACCOUNT_OWNERSHIP_INVALID", "A conta não pertence ao usuário autenticado.");
    if (message.includes("provider conflict")) throw new MetaLinkError("PROVIDER_CONFLICT", "A conta já está vinculada a outro provedor.");
    throw new MetaLinkError("DATABASE_ERROR", "Não foi possível salvar a conexão Instagram.");
  }
  return account[0];
}

export async function persistOAuthMetaAccount(rpc: OAuthLinkRpc, input: { userId: string; handle: string; providerAccountId: string; accessTokenCiphertext: string; expiresAt: Date }): Promise<LinkedSocialAccount> {
  const { data: account, error } = await rpc("link_meta_oauth_account", {
    p_user_id: input.userId,
    p_username: input.handle,
    p_provider_account_id: input.providerAccountId,
    p_access_token_ciphertext: input.accessTokenCiphertext,
    p_expires_at: input.expiresAt.toISOString(),
  });
  if (error || !account?.[0]) {
    const message = error?.message ?? "";
    if (message.includes("account ownership mismatch")) throw new MetaLinkError("ACCOUNT_OWNERSHIP_INVALID", "Esta conta Instagram já está vinculada a outro usuário.");
    throw new MetaLinkError("DATABASE_ERROR", "Não foi possível salvar a conexão Instagram.");
  }
  return account[0];
}
