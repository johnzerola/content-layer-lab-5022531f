import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, jsonResult } from "../supabase";

export default defineTool({
  name: "list_exports",
  title: "Arquivos exportados",
  description: "Lista os vídeos exportados registrados na conta, com nome, tamanho e data.",
  inputSchema: { limit: z.number().int().optional().describe("Máximo de registros (padrão 20).") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const max = Math.min(Math.max(limit ?? 20, 1), 100);
    const { data, error } = await supabaseForUser(ctx)
      .from("exports")
      .select("id,mode,file_name,bytes,variant,created_at")
      .order("created_at", { ascending: false })
      .limit(max);
    if (error) return errorResult(error.message);
    return jsonResult({ exports: data ?? [] });
  },
});
