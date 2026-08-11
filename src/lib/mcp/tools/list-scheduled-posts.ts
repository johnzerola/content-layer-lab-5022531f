import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, jsonResult } from "../supabase";

export default defineTool({
  name: "list_scheduled_posts",
  title: "Postagens agendadas",
  description: "Lista as postagens agendadas para redes sociais, com status e legenda.",
  inputSchema: {
    status: z.string().optional().describe("Filtra por status, ex.: pending, done, error."),
    limit: z.number().int().optional().describe("Máximo de registros (padrão 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const max = Math.min(Math.max(limit ?? 20, 1), 100);
    let query = supabaseForUser(ctx)
      .from("scheduled_posts")
      .select("id,kind,caption,status,file_name,permalink,attempts,error,created_at")
      .order("created_at", { ascending: false })
      .limit(max);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return jsonResult({ posts: data ?? [] });
  },
});
