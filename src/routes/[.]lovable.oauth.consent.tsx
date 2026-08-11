import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthzDetails | null; error: Error | null }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthzDetails | null; error: Error | null }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthzDetails | null; error: Error | null }>;
};
type AuthzDetails = {
  client?: { name?: string } | null;
  redirect_url?: string;
  redirect_to?: string;
};

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s['authorization_id'] === "string" ? s['authorization_id'] : "",
  }),
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id");
    if (!authorizationId) throw new Error("Parâmetro authorization_id ausente.");
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return null;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <p className="text-sm text-destructive">
        Não foi possível carregar esta autorização: {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error: e } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (e) {
      setBusy(false);
      setError(e.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("O servidor de autorização não retornou um redirecionamento.");
      return;
    }
    window.location.href = target;
  }

  async function signInEmail() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    window.location.reload();
  }

  if (signedIn === null) {
    return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">Carregando…</main>;
  }

  if (!signedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="panel w-full max-w-sm space-y-3 p-5">
          <p className="mono-label">Conectar</p>
          <h1 className="text-lg font-semibold">Entre na sua conta VaiViral</h1>
          <p className="text-sm text-muted-foreground">Faça login para autorizar o aplicativo a acessar seus dados.</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="senha"
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
          />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void signInEmail()}>Entrar</Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.href })
              }
            >
              Entrar com Google
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel w-full max-w-sm space-y-3 p-5">
        <p className="mono-label">Autorização</p>
        <h1 className="text-lg font-semibold">
          Conectar {details?.client?.name ?? "um aplicativo"} à sua conta
        </h1>
        <p className="text-sm text-muted-foreground">
          Isso permite que {details?.client?.name ?? "o aplicativo"} consulte seus templates, projetos, lotes,
          exportações e agendamentos como você.
        </p>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void decide(true)}>Aprovar</Button>
          <Button variant="outline" disabled={busy} onClick={() => void decide(false)}>Recusar</Button>
        </div>
      </div>
    </main>
  );
}
