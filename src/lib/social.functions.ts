import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  executeInstagramAccountLink,
  linkingServerRuntimeReady,
} from "@/lib/social-linking.server";
import { persistValidatedMetaAccount } from "@/lib/social-persistence.server";

export const addAccount = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((data: unknown) => z.object({ username: z.string().min(1).max(64) }).parse(data))
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
