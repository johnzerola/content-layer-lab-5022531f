import { MetaLinkError, type LinkedSocialAccount } from "@/lib/social-linking.server";

type LinkRpc = (
  name: "link_global_meta_account",
  args: { p_user_id: string; p_username: string; p_provider_account_id: string },
) => PromiseLike<{ data: LinkedSocialAccount[] | null; error: { message: string } | null }>;

export async function persistValidatedMetaAccount(
  rpc: LinkRpc,
  input: { userId: string; handle: string; providerAccountId: string },
): Promise<LinkedSocialAccount> {
  const { data: account, error } = await rpc("link_global_meta_account", {
    p_user_id: input.userId,
    p_username: input.handle,
    p_provider_account_id: input.providerAccountId,
  });
  if (error || !account?.[0]) {
    const message = error?.message ?? "";
    console.error("META_LINK_RPC_ERROR", JSON.stringify(error));
    if (message.includes("account ownership mismatch")) {
      throw new MetaLinkError(
        "ACCOUNT_OWNERSHIP_INVALID",
        "A conta não pertence ao usuário autenticado.",
      );
    }
    if (message.includes("provider conflict")) {
      throw new MetaLinkError("PROVIDER_CONFLICT", "A conta já está vinculada a outro provedor.");
    }
    throw new MetaLinkError("DATABASE_ERROR", `DBG: ${message}`);
  }
  return account[0];
}
