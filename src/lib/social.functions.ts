import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  configuredMetaCredentials,
  linkConfiguredInstagramAccount,
  MetaLinkError,
  type LinkedSocialAccount,
} from "@/lib/social-linking.server";

export const addAccount = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((data: unknown) => z.object({ username: z.string().min(1).max(64) }).parse(data))
  .handler(async ({ data, context }) => {
    try {
      const credentials = configuredMetaCredentials();
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return await linkConfiguredInstagramAccount({
        userId: context.userId,
        requestedHandle: data.username,
        credentials,
        persist: async ({ userId, handle, providerAccountId }) => {
          const { data: account, error } = await supabaseAdmin.rpc("link_global_meta_account", {
            p_user_id: userId,
            p_username: handle,
            p_provider_account_id: providerAccountId,
          });
          if (error || !account?.[0]) {
            const message = error?.message ?? "";
            if (message.includes("account ownership mismatch")) {
              throw new MetaLinkError(
                "ACCOUNT_OWNERSHIP_INVALID",
                "A conta não pertence ao usuário autenticado.",
              );
            }
            if (message.includes("provider conflict")) {
              throw new MetaLinkError(
                "PROVIDER_CONFLICT",
                "A conta já está vinculada a outro provedor.",
              );
            }
            throw new MetaLinkError(
              "DATABASE_ERROR",
              "Não foi possível salvar a conexão Instagram.",
            );
          }
          return account[0] as LinkedSocialAccount;
        },
      });
    } catch (error) {
      if (error instanceof MetaLinkError) throw new Error(error.message);
      throw new Error("Não foi possível conectar a conta Instagram.");
    }
  });
