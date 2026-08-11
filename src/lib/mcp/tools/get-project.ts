import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, jsonResult } from "../supabase";

export default defineTool({
  name: "get_project",
  title: "Obter projeto",
  description: "Retorna o conteúdo de um projeto salvo, incluindo itens e configurações.",
  inputSchema: { id: z.string().describe("ID do projeto retornado por list_projects.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("projects")
      .select("id,name,mode,data,updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return errorResult("Projeto não encontrado.");
    return jsonResult({ project: data });
  },
});
