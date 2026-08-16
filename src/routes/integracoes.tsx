import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Facebook, Instagram, Settings2, TriangleAlert, Youtube } from "lucide-react";
import { currentUser, onAuth, type CloudUser } from "@/lib/cloud";
import { listAccounts, type SocialAccount } from "@/lib/social";
import { AppShell, type AppMode } from "@/components/AppShell";
import { listJobs } from "@/lib/jobs";

export const Route = createFileRoute("/integracoes")({
  component: IntegrationsPage,
  head: () => ({
    meta: [
      { title: "Integrações sociais — VaiViral" },
      { name: "description", content: "Status verdadeiro das conexões de publicação em redes sociais." },
    ],
  }),
});

type IntegrationCard = {
  platform: "instagram" | "facebook" | "tiktok" | "youtube";
  name: string;
  description: string;
  icon: typeof Instagram;
};

const INTEGRATIONS: IntegrationCard[] = [
  {
    platform: "instagram",
    name: "Instagram",
    description: "Reels e Stories por Meta Graph API ou Ayrshare.",
    icon: Instagram,
  },
  {
    platform: "facebook",
    name: "Facebook",
    description: "Adapter de publicação ainda não implementado.",
    icon: Facebook,
  },
  {
    platform: "tiktok",
    name: "TikTok",
    description: "Content Posting API ainda não configurada.",
    icon: Settings2,
  },
  {
    platform: "youtube",
    name: "YouTube",
    description: "Upload de Shorts ainda não configurado.",
    icon: Youtube,
  },
];

function IntegrationsPage() {
  const [mode, setMode] = useState<AppMode>("external");
  const jobs = listJobs();
  const [user, setUser] = useState<CloudUser | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);

  useEffect(() => {
    void currentUser().then(setUser);
    return onAuth(setUser);
  }, []);

  useEffect(() => {
    if (!user) {
      setAccounts([]);
      return;
    }
    void listAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, [user]);

  return (
    <AppShell
      mode={mode}
      onMode={setMode}
      count={jobs.length}
      onLibrary={() => {}}
      onCloud={() => {}}
    >
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <section className="mb-6 rounded-2xl border border-border/70 bg-[var(--gradient-surface)] p-5">
          <p className="mono-label text-primary">Configurações · APIs sociais</p>
          <h2 className="mt-2 font-display text-2xl font-bold">Conecte somente por autorização oficial</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Senhas e tokens nunca são solicitados nesta tela. Uma plataforma só aparece como conectada depois que
            o backend confirma uma autorização válida.
          </p>
        </section>

        {!user && (
          <div className="rounded-2xl border border-border bg-surface/60 p-6 text-center text-sm text-muted-foreground">
            Faça login na Nuvem para consultar suas conexões.
          </div>
        )}

        {user && (
          <div className="grid gap-4 sm:grid-cols-2">
            {INTEGRATIONS.map((integration) => {
              const Icon = integration.icon;
              const platformAccounts = accounts.filter((account) => account.platform === integration.platform);
              const connected = platformAccounts.filter(
                (account) => account.status === "conectado" && account.provider !== "pending",
              );
              const available = integration.platform === "instagram";
              return (
                <article key={integration.platform} className="rounded-2xl border border-border/70 bg-surface/60 p-5">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/35 bg-primary/12 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-lg font-semibold">{integration.name}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{integration.description}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
                    {connected.length > 0 ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-400">
                        <CheckCircle2 className="size-4" /> Conectado
                      </div>
                    ) : platformAccounts.length > 0 ? (
                      <div>
                        <div className="flex items-center gap-2 text-sm text-amber-400">
                          <TriangleAlert className="size-4" /> Atenção necessária
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {platformAccounts.map((account) => `@${account.username}`).join(", ")} ainda não possui
                          autorização real.
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Não conectado</p>
                    )}
                  </div>

                  {available ? (
                    <Link
                      to="/agenda"
                      className="mt-4 flex w-full items-center justify-center rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground transition hover:text-foreground"
                    >
                      Gerenciar contas da agenda
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="mt-4 w-full rounded-xl border border-border px-3 py-2.5 text-sm text-muted-foreground opacity-60"
                    >
                      Em preparação
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}
