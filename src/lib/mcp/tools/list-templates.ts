import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, jsonResult } from "../supabase";

export default defineTool({
  name: "list_templates",
  title: "Listar templates",
  description: "Lista os templates de vídeo salvos na nuvem pelo usuário conectado.",
  inputSchema: { limit: z.number().int().optional().describe("Máximo de templates (padrão 20).") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const max = Math.min(Math.max(limit ?? 20, 1), 100);
    const { data, error } = await supabaseForUser(ctx)
      .from("templates")
      .select("id,local_id,name,updated_at")
      .order("updated_at", { ascending: false })
      .limit(max);
    if (error) return errorResult(error.message);
    return jsonResult({ templates: data ?? [] });
  },
});
