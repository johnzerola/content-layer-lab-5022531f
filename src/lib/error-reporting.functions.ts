import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const reportClientError = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((input: any) => input)
  .handler(async ({ data, context }: any) => {
    console.error(`[ClientError] User: ${context.userId} | Route: ${data.route}`, data.message, data.stack);
    return { ok: true };
  });
