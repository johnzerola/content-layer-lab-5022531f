import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  executeInstagramAccountLink,
  linkingServerRuntimeReady,
} from "@/lib/social-linking.server";
import { persistValidatedMetaAccount } from "@/lib/social-persistence.server";

const addAccountInputSchema = z.object({
  username: z.string().max(64).optional().default(""),
});

export function parseAddAccountInput(data: unknown): { username: string } {
  const parsed = addAccountInputSchema.safeParse(data);
  return parsed.success ? parsed.data : { username: "" };
}

export const addAccount = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator(parseAddAccountInput)
  .handler(async ({ data, context }) => {
    if (!linkingServerRuntimeReady()) {
      return {
        ok: false as const,
        code: "SERVER_CONFIG_MISSING" as const,
        error: "A integração segura do servidor não está configurada.",
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return executeInstagramAccountLink({
      userId: context.userId,
      requestedHandle: data.username,
      persist: (input) =>
        persistValidatedMetaAccount(
          (name, args) => supabaseAdmin.rpc(name, args),
          input,
        ),
    });
  });
