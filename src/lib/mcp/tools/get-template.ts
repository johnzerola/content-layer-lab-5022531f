import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthenticated, errorResult, jsonResult } from "../supabase";

export default defineTool({
  name: "get_template",
  title: "Obter template",
  description: "Retorna o conteúdo completo (camadas, fontes, cores) de um template salvo.",
  inputSchema: { id: z.string().describe("ID do template retornado por list_templates.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthenticated();
    const { data, error } = await supabaseForUser(ctx)
      .from("templates")
      .select("id,local_id,name,data,updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return errorResult(error.message);
    if (!data) return errorResult("Template não encontrado.");
    return jsonResult({ template: data });
  },
});
