import { auth, defineMcp, type McpDefinitionInput } from "@lovable.dev/mcp-js";
import listTemplates from "./tools/list-templates";
import getTemplate from "./tools/get-template";
import listProjects from "./tools/list-projects";
import getProject from "./tools/get-project";
import listBatches from "./tools/list-batches";
import listExports from "./tools/list-exports";
import listScheduledPosts from "./tools/list-scheduled-posts";

const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "video-creator-suite",
  title: "Video Creator Suite",
  version: "0.1.0",
  instructions:
    "Ferramentas do VaiViral (Video Creator Suite): consulte templates de vídeo, projetos salvos (ViralBatch, CorteIA, LimpaVídeo), histórico de lotes, arquivos exportados e postagens agendadas do usuário conectado.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    listTemplates,
    getTemplate,
    listProjects,
    getProject,
    listBatches,
    listExports,
    listScheduledPosts,
  ] as unknown as McpDefinitionInput["tools"],
});
