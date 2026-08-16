import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const errorSchema = z.object({ 
  message: z.string(), 
  stack: z.string().optional(),
  route: z.string().optional(),
  context: z.record(z.unknown()).optional()
});

export const reportClientError = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((input: any) => errorSchema.parse(input))
  .handler(async ({ data, context }) => {
    console.error(`[ClientError] User: ${context.userId} | Route: ${data.route}`, data.message, data.stack);
    return { ok: true };
  });
