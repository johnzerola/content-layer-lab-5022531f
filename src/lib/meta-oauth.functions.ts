import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  exchangeInstagramAuthorizationCode,
  fetchOAuthInstagramIdentity,
  instagramAuthorizationUrl,
  verifyInstagramOAuthState,
} from "@/lib/meta-oauth.server";
import { MetaLinkError, type LinkAccountResult } from "@/lib/social-linking.server";
import { persistValidatedMetaAccount } from "@/lib/social-persistence.server";

function oauthError(error: unknown): Extract<LinkAccountResult, { ok: false }> {
  if (error instanceof MetaLinkError) {
    return { ok: false, code: error.code, error: error.message };
  }
  return { ok: false, code: "META_AUTH_INVALID", error: "Não foi possível conectar o Instagram." };
}

export const beginInstagramOAuth = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      return { ok: true as const, authorizationUrl: instagramAuthorizationUrl(context.userId) };
    } catch (error) {
      return oauthError(error);
    }
  });

export const completeInstagramOAuth = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(4096) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    try {
      verifyInstagramOAuthState(data.state, context.userId);
      const exchanged = await exchangeInstagramAuthorizationCode({ code: data.code });
      const identity = await fetchOAuthInstagramIdentity({ accessToken: exchanged.accessToken });
      const configuredAccountId = process.env["META_IG_USER_ID"]?.trim();
      if (!configuredAccountId || identity.id !== configuredAccountId || exchanged.userId !== identity.id) {
        throw new MetaLinkError(
          "META_ACCOUNT_MISMATCH",
          "A conta escolhida não corresponde à conta Instagram configurada para publicação.",
        );
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const account = await persistValidatedMetaAccount(
        (name, args) => supabaseAdmin.rpc(name, args),
        { userId: context.userId, handle: identity.username, providerAccountId: identity.id },
      );
      return { ok: true as const, account };
    } catch (error) {
      return oauthError(error);
    }
  });
