import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, jsonResult } from "../supabase";

export default defineTool({
  name: "list_projects",
  title: "Listar projetos",
  description: "Lista os projetos salvos na nuvem (ViralBatch, CorteIA, LimpaVídeo).",
  inputSchema: {
    mode: z.string().optional().describe("Filtra por ferramenta: lote, clip ou limpar."),
    limit: z.number().int().optional().describe("Máximo de projetos (padrão 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ mode, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const max = Math.min(Math.max(limit ?? 20, 1), 100);
    let query = supabaseForUser(ctx)
      .from("projects")
      .select("id,name,mode,updated_at")
      .order("updated_at", { ascending: false })
      .limit(max);
    if (mode) query = query.eq("mode", mode);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return jsonResult({ projects: data ?? [] });
  },
});
