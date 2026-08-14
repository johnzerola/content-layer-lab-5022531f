import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ResultLibrary } from "@/components/ResultLibrary";

export const Route = createFileRoute("/biblioteca")({
  component: BibliotecaPage,
  head: () => ({
    meta: [
      { title: "Biblioteca de Resultados — VaiViral" },
      {
        name: "description",
        content: "Histórico completo de todos os vídeos exportados, organizados por lote e plataforma.",
      },
      { property: "og:title", content: "Biblioteca de Resultados — VaiViral" },
      { property: "og:type", content: "website" },
    ],
  }),
});

function BibliotecaPage() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight">Biblioteca de Resultados</h1>
          <p className="mt-2 text-muted-foreground">
            Acompanhe e busque todos os vídeos que você já exportou no sistema.
          </p>
        </header>

        <ResultLibrary />
      </div>
    </AppShell>
  );
}
