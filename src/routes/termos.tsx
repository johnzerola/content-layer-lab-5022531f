import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/termos")({
  component: TermsPage,
  head: () => ({ meta: [{ title: "Termos de uso - VaiViral" }] }),
});

function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 text-sm leading-relaxed">
      <Link to="/" className="text-muted-foreground hover:text-foreground">
        Voltar
      </Link>
      <h1 className="mt-6 font-display text-3xl font-bold">Termos de uso</h1>
      <p className="mt-4 text-muted-foreground">
        Use o VaiViral apenas com vídeos próprios, licenciados ou que você tenha autorização para editar e publicar.
      </p>
      <h2 className="mt-8 font-display text-xl font-semibold">Processamento</h2>
      <p className="mt-2 text-muted-foreground">
        O editor em lote roda no navegador. Recursos como CleanerIA, importação por link, armazenamento em nuvem e
        Agenda podem enviar arquivos, URLs e metadados para VPS, Supabase ou para APIs das redes sociais escolhidas.
      </p>
      <h2 className="mt-8 font-display text-xl font-semibold">Publicação</h2>
      <p className="mt-2 text-muted-foreground">
        Publicações automáticas exigem conta autorizada por OAuth/API oficial e consentimento por postagem. O usuário é
        responsável pelo conteúdo, direitos autorais, legendas, marcas e conformidade com as regras de cada plataforma.
      </p>
      <h2 className="mt-8 font-display text-xl font-semibold">Limites</h2>
      <p className="mt-2 text-muted-foreground">
        Podemos bloquear tarefas que excedam capacidade técnica, abusem de proxy, violem regras das plataformas ou
        tentem acessar recursos privados sem autorização.
      </p>
    </main>
  );
}
