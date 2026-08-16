import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, type AppMode } from "@/components/AppShell";
import { ResultLibrary } from "@/components/ResultLibrary";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import { CloudPanel } from "@/components/CloudPanel";
import { listJobs } from "@/lib/jobs";
import type { Template } from "@/lib/template";
import { currentUser } from "@/lib/cloud";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/biblioteca")({
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");
  },
  errorComponent: ({ error }) => {
    if (error.message === "Unauthorized") {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center p-4">
          <AuthGate>
            <div className="hidden">Autenticado com sucesso!</div>
          </AuthGate>
        </div>
      );
    }
    return <div>Erro ao carregar biblioteca: {error.message}</div>;
  },
  component: BibliotecaPage,
  head: () => ({
    meta: [
      { title: "Biblioteca de Resultados — VaiViral" },
      {
        name: "description",
        content:
          "Histórico completo de todos os vídeos exportados, organizados por lote e plataforma.",
      },
      { property: "og:title", content: "Biblioteca de Resultados — VaiViral" },
      { property: "og:type", content: "website" },
    ],
  }),
});

function BibliotecaPage() {
  const [mode, setMode] = useState<AppMode>("external");
  const [libOpen, setLibOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const jobs = listJobs();

  return (
    <AppShell
      mode={mode}
      onMode={setMode}
      count={jobs.length}
      onLibrary={() => setLibOpen(true)}
      onCloud={() => setCloudOpen(true)}
    >
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Biblioteca de Resultados
          </h1>
          <p className="mt-2 text-muted-foreground">
            Acompanhe e busque todos os vídeos que você já exportou no sistema.
          </p>
        </header>

        <ResultLibrary />
      </div>

      {libOpen && (
        <TemplateLibrary
          templates={templates}
          activeId=""
          onClose={() => setLibOpen(false)}
          onChangeList={setTemplates}
          onUse={() => {}}
          onCommit={(t) => t}
        />
      )}

      {cloudOpen && (
        <CloudPanel
          templates={templates}
          onClose={() => setCloudOpen(false)}
          onChangeList={setTemplates}
          mode={mode}
          buildSnapshot={() => ({ items: [] })}
          onRestore={() => {}}
        />
      )}
    </AppShell>
  );
}
