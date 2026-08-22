import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { completeInstagramOAuth } from "@/lib/meta-oauth.functions";

const callbackSearch = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/integracoes_/instagram/callback")({
  validateSearch: callbackSearch,
  component: InstagramOAuthCallback,
});

function InstagramOAuthCallback() {
  const search = Route.useSearch();
  const completeOAuth = useServerFn(completeInstagramOAuth);
  const started = useRef(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (search.error || !search.code || !search.state) {
      setResult({
        ok: false,
        message: search.error_description || "A autorização do Instagram foi cancelada.",
      });
      return;
    }
    void completeOAuth({ data: { code: search.code, state: search.state } })
      .then((response) => {
        setResult(
          response.ok
            ? { ok: true, message: `@${response.account.username} foi conectado com sucesso.` }
            : { ok: false, message: response.error },
        );
      })
      .catch(() => setResult({ ok: false, message: "Não foi possível concluir a conexão." }));
  }, [completeOAuth, search.code, search.error, search.error_description, search.state]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <section className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
        {!result ? (
          <>
            <Loader2 className="mx-auto size-8 animate-spin text-primary" />
            <h1 className="mt-4 font-display text-xl font-semibold">Conectando Instagram…</h1>
          </>
        ) : (
          <>
            {result.ok ? (
              <CheckCircle2 className="mx-auto size-8 text-emerald-400" />
            ) : (
              <TriangleAlert className="mx-auto size-8 text-amber-400" />
            )}
            <h1 className="mt-4 font-display text-xl font-semibold">
              {result.ok ? "Instagram conectado" : "Conexão não concluída"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{result.message}</p>
            <Link
              to="/agenda"
              className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
            >
              Voltar para a Agenda
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
