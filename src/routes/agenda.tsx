import { createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Instagram, Loader2, Plus, Trash2, UploadCloud, X, Youtube, Video } from "lucide-react";
import { AppShell, type AppMode } from "@/components/AppShell";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import { CloudPanel } from "@/components/CloudPanel";
import { listJobs } from "@/lib/jobs";
import type { Template } from "@/lib/template";
import {
  KIND_LABEL,
  STATUS_LABEL,
  cancelPost,
  deletePost,
  listAccounts,
  listPosts,
  removeAccount,
  reschedulePost,
  resolveAccountLinkUi,
  schedulePost,
  uploadPostVideo,
  type PostKind,
  type ScheduledPost,
  type SocialAccount,
} from "@/lib/social";

import { addAccount } from "@/lib/social.functions";
import { currentUser, onAuth, type CloudUser } from "@/lib/cloud";
import { AuthGate } from "@/components/AuthGate";

export const Route = createFileRoute("/agenda")({
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw redirect({ to: "/" });
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
    return <div>Erro ao carregar agenda: {error.message}</div>;
  },
  component: AgendaPage,
  head: () => ({
    meta: [
      { title: "Agenda de postagens — VaiViral" },
      {
        name: "description",
        content:
          "Conecte contas do Instagram, envie os vídeos prontos e agende Reels, Feed e Stories para publicarem sozinhos no horário escolhido.",
      },
      { property: "og:title", content: "Agenda de postagens — VaiViral" },
      {
        property: "og:description",
        content:
          "Fila de publicação automática de Reels, Feed e Stories para as contas conectadas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_STYLE: Record<string, string> = {
  agendado: "border-primary/40 bg-primary/12 text-primary",
  processando: "border-border bg-surface-2 text-muted-foreground",
  publicado: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  falhou: "border-red-500/40 bg-red-500/10 text-red-400",
  cancelado: "border-border bg-surface-2 text-muted-foreground",
};

function AgendaPage() {
  const [mode, setMode] = useState<AppMode>("external");
  const [libOpen, setLibOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const jobs = listJobs();

  const [user, setUser] = useState<CloudUser | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingAccount, setLinkingAccount] = useState(false);
  const linkAccount = useServerFn(addAccount);

  const [handle, setHandle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [kind, setKind] = useState<PostKind>("reels");
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([listAccounts(), listPosts()]);
      setAccounts(a);
      setPosts(p);
      if (!accountId && a[0]) setAccountId(a[0].id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar a agenda.");
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void currentUser().then(setUser);
    return onAuth(setUser);
  }, []);

  useEffect(() => {
    if (user) void refresh();
    else {
      setAccounts([]);
      setPosts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const grouped = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    for (const p of posts) {
      const key = new Date(p.scheduled_at).toLocaleDateString("pt-BR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      });
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()];
  }, [posts]);

  async function onAddAccount() {
    setLinkingAccount(true);
    try {
      const result = await linkAccount({ data: { username: handle } });
      const ui = resolveAccountLinkUi(accounts, result);
      if (!ui.ok) {
        toast.error(ui.error);
        return;
      }
      setAccounts(ui.accounts);
      setHandle("");
      toast.success("Conta Instagram conectada.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível adicionar.");
    } finally {
      setLinkingAccount(false);
    }
  }

  async function onSchedule() {
    if (!file) {
      toast.error("Escolha o vídeo que será publicado.");
      return;
    }
    setSending(true);
    try {
      const up = await uploadPostVideo(file, file.name);
      await schedulePost({
        accountId: accountId || null,
        kind,
        caption,
        scheduledAt: new Date(when),
        videoPath: up.path,
        videoUrl: up.url,
        fileName: file.name,
        consent,
      });
      setFile(null);
      setCaption("");
      setConsent(false);
      toast.success("Publicação agendada.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao agendar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell
      mode="lote"

      onMode={setMode}
      count={jobs.length}
      onLibrary={() => setLibOpen(true)}
      onCloud={() => setCloudOpen(true)}
    >
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <section className="mb-6 rounded-2xl border border-border/70 bg-[var(--gradient-surface)] p-5 shadow-[var(--shadow-panel)]">
          <p className="mono-label flex items-center gap-2 text-primary">
            <CalendarClock className="size-3.5" /> publicação automática
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
            Seus vídeos vão ao ar sozinhos
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Envie o MP4 pronto, escolha a conta, o formato e a hora. A publicacao automatica so
            roda em contas conectadas por OAuth/API oficial; contas digitadas manualmente ficam como
            rascunho ate a conexao real ser configurada.
          </p>
        </section>

        {!user && (
          <div className="rounded-2xl border border-border bg-surface/60 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Faça login na aba <strong className="text-foreground">Nuvem</strong> para conectar
              contas e agendar publicações.
            </p>
          </div>
        )}

        {user && (
          <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
            <div className="flex flex-col gap-6">
              {/* contas */}
              <section className="rounded-2xl border border-border/70 bg-surface/60 p-5">
                <p className="mono-label pb-3">Contas conectadas</p>
                <div className="flex gap-2">
                  <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3">
                    <select 
                      className="bg-transparent text-sm outline-none border-r border-border mr-1"
                      onChange={(e) => setHandle(`@${e.target.value}`)}
                    >
                      <option value="instagram">Instagram</option>
                      <option value="youtube">YouTube</option>
                      <option value="tiktok">TikTok</option>
                    </select>
                    <input
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      placeholder="@suapagina"
                      className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <button
                    onClick={onAddAccount}
                    disabled={linkingAccount}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground"
                  >
                    {linkingAccount ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    {linkingAccount ? "Validando…" : "Add"}
                  </button>
                </div>

                <ul className="mt-3 flex flex-col gap-2">
                  {accounts.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/35 bg-primary/12 text-primary">
                        {a.platform === "youtube" ? <Youtube className="size-4" /> : a.platform === "tiktok" ? <Video className="size-4" /> : <Instagram className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">@{a.username}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {a.status === "connected" || a.status === "conectado"
                            ? `conectada via ${a.provider}`
                            : a.status === "aguardando provedor"
                              ? "pendente: aguardando configuração da API"
                              : "rascunho; falta OAuth/API"}
                        </span>
                      </span>

                      <button
                        onClick={async () => {
                          await removeAccount(a.id);
                          await refresh();
                        }}
                        aria-label={`Remover @${a.username}`}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:text-red-400"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </li>
                  ))}
                  {!accounts.length && (
                    <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center font-mono text-[11px] text-muted-foreground">
                      nenhuma conta ainda
                    </li>
                  )}
                </ul>
              </section>

              {/* novo agendamento */}
              <section className="rounded-2xl border border-border/70 bg-surface/60 p-5">
                <p className="mono-label pb-3">Nova publicação</p>

                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-surface-2 px-3 py-4 text-sm text-muted-foreground transition hover:text-foreground">
                  <UploadCloud className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {file ? file.name : "Escolher vídeo MP4 exportado"}
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </label>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="mono-label">Conta</span>
                    <select
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none"
                    >
                      <option value="">— selecionar —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          @{a.username}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="mono-label">Formato</span>
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value as PostKind)}
                      className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none"
                    >
                      <option value="reels">Reels</option>
                      <option value="feed">Feed</option>
                      <option value="stories">Stories</option>
                      <option value="shorts">Shorts</option>
                    </select>
                  </label>
                </div>

                <label className="mt-3 flex flex-col gap-1.5">
                  <span className="mono-label">Legenda</span>
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    rows={3}
                    placeholder="Escreva a legenda com hashtags…"
                    className="resize-none rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </label>

                <label className="mt-3 flex flex-col gap-1.5">
                  <span className="mono-label">Data e hora</span>
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none"
                  />
                </label>

                <label className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <span>
                    Confirmo que tenho direito de publicar este vídeo e autorizo o envio do arquivo à rede social
                    escolhida no horário agendado.
                  </span>
                </label>

                <button
                  onClick={onSchedule}
                  disabled={sending}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CalendarClock className="size-4" />
                  )}
                  {sending ? "Enviando…" : "Agendar publicação"}
                </button>
              </section>
            </div>

            {/* fila */}
            <section className="rounded-2xl border border-border/70 bg-surface/60 p-5">
              <div className="flex items-center justify-between pb-3">
                <p className="mono-label">Fila</p>
                {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              </div>

              {!posts.length && (
                <p className="rounded-xl border border-dashed border-border px-3 py-10 text-center font-mono text-[11px] text-muted-foreground">
                  nada agendado ainda
                </p>
              )}

              <div className="flex flex-col gap-5">
                {grouped.map(([day, list]) => (
                  <div key={day}>
                    <p className="mono-label pb-2 text-primary">{day}</p>
                    <ul className="flex flex-col gap-2">
                      {list.map((p) => (
                        <li key={p.id} className="rounded-xl border border-border bg-surface-2 p-3">
                          <div className="flex items-start gap-3">
                            <span className="shrink-0 rounded-lg border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground">
                              {new Date(p.scheduled_at).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {KIND_LABEL[p.kind] ?? p.kind} · {p.file_name ?? "vídeo"}
                              </p>
                              {p.caption && (
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {p.caption}
                                </p>
                              )}
                              {p.error && (
                                <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2">
                                  <p className="font-mono text-[10px] leading-tight text-red-400">
                                    ERRO: {p.error}
                                  </p>
                                </div>
                              )}
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                                STATUS_STYLE[p.status] ?? "border-border text-muted-foreground"
                              }`}
                            >
                              {STATUS_LABEL[p.status] ?? p.status}
                            </span>
                          </div>
                          <div className="mt-3 flex justify-end gap-2 border-t border-border/50 pt-2">
                            {p.status === "falhou" && (
                              <button
                                onClick={async () => {
                                  try {
                                    await reschedulePost(p.id, new Date(Date.now() + 5 * 60 * 1000));
                                    toast.success("Publicação reenviada para a fila.");
                                    await refresh();
                                  } catch (e) {
                                    toast.error("Falha ao re-agendar.");
                                  }
                                }}
                                className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20"
                              >
                                Tentar agora
                              </button>
                            )}
                            {p.status === "agendado" && (
                              <>
                                <button
                                  onClick={async () => {
                                    try {
                                      // Para publicação imediata, agendamos para o passado
                                      await reschedulePost(p.id, new Date(Date.now() - 60000));
                                      toast.success("Enviando para publicação imediata...");
                                      await refresh();
                                    } catch (e) {
                                      toast.error("Falha ao forçar publicação.");
                                    }
                                  }}
                                  className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20"
                                >
                                  Tentar agora
                                </button>
                                <button
                                  onClick={async () => {
                                    await cancelPost(p.id);
                                    await refresh();
                                  }}
                                  className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground transition hover:text-foreground"
                                >
                                  <X className="size-3" /> cancelar
                                </button>
                              </>
                            )}
                            <button
                              onClick={async () => {
                                await deletePost(p.id);
                                await refresh();
                              }}
                              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground transition hover:text-red-400"
                            >
                              <Trash2 className="size-3" /> excluir
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

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
