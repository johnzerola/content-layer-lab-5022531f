import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacidade")({
  component: PrivacyPage,
  head: () => ({ meta: [{ title: "Privacidade e LGPD - VaiViral" }] }),
});

function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10 text-sm leading-relaxed">
      <Link to="/" className="text-muted-foreground hover:text-foreground">
        Voltar
      </Link>
      <h1 className="mt-6 font-display text-3xl font-bold">Privacidade e LGPD</h1>
      <p className="mt-4 text-muted-foreground">
        Coletamos dados de conta, templates, histórico de lotes, jobs do CleanerIA, arquivos agendados e logs técnicos
        necessários para operar o serviço.
      </p>
      <h2 className="mt-8 font-display text-xl font-semibold">Arquivos e vídeos</h2>
      <p className="mt-2 text-muted-foreground">
        Vídeos do lote comum ficam no navegador. CleanerIA envia o arquivo para a VPS de processamento. Agenda armazena
        o arquivo no Supabase Storage até a publicação e remove o arquivo após envio bem-sucedido. Links importados são
        resolvidos por servidor com tickets temporários.
      </p>
      <h2 className="mt-8 font-display text-xl font-semibold">Redes sociais</h2>
      <p className="mt-2 text-muted-foreground">
        Quando você agenda uma postagem, o vídeo e a legenda são enviados para a rede social selecionada usando a conta
        conectada e autorizada. Tokens devem ficar em ambiente seguro ou referência de segredo, nunca expostos no painel.
      </p>
      <h2 className="mt-8 font-display text-xl font-semibold">Seus direitos</h2>
      <p className="mt-2 text-muted-foreground">
        Você pode solicitar acesso, correção ou exclusão dos dados. A página de conta permite iniciar a exclusão da
        conta e dos dados vinculados.
      </p>
    </main>
  );
}
