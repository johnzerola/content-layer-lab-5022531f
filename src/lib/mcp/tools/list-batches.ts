import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, jsonResult } from "../supabase";

export default defineTool({
  name: "list_batches",
  title: "Histórico de lotes",
  description: "Lista o histórico de processamentos em lote com contagem de sucessos e erros.",
  inputSchema: { limit: z.number().int().optional().describe("Máximo de registros (padrão 20).") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const max = Math.min(Math.max(limit ?? 20, 1), 100);
    const { data, error } = await supabaseForUser(ctx)
      .from("batches")
      .select("id,mode,videos,ok,failed,seconds,created_at")
      .order("created_at", { ascending: false })
      .limit(max);
    if (error) return errorResult(error.message);
    return jsonResult({ batches: data ?? [] });
  },
});
