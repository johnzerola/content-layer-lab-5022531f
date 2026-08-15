import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarClock,
  Instagram,
  Loader2,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  KIND_LABEL,
  STATUS_LABEL,
  addAccount,
  cancelPost,
  deletePost,
  listAccounts,
  listPosts,
  removeAccount,
  schedulePost,
  uploadPostVideo,
  type PostKind,
  type ScheduledPost,
  type SocialAccount,
} from "@/lib/social";
import { currentUser, onAuth, type CloudUser } from "@/lib/cloud";

export const Route = createFileRoute("/agenda")({
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
        content: "Fila de publicação automática de Reels, Feed e Stories para as contas conectadas.",
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
  const [user, setUser] = useState<CloudUser | null>(null);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);

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
    try {
      await addAccount(handle);
      setHandle("");
      toast.success("Conta adicionada como rascunho. Conecte via provedor oficial antes de publicar.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível adicionar.");
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
    <div className="theme-lote min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Voltar
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold tracking-tight">Agenda de postagens</h1>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              Reels · Feed · Stories no horário certo
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <section className="mb-6 rounded-2xl border border-border/70 bg-[var(--gradient-surface)] p-5 shadow-[var(--shadow-panel)]">
          <p className="mono-label flex items-center gap-2 text-primary">
            <CalendarClock className="size-3.5" /> publicação automática
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
            Seus vídeos vão ao ar sozinhos
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Envie o MP4 pronto, escolha a conta, o formato e a hora. A publicação automática só roda em
            contas conectadas por OAuth/API oficial; contas digitadas manualmente ficam como rascunho até a
            conexão real ser configurada.
          </p>
        </section>

        {!user && (
          <div className="rounded-2xl border border-border bg-surface/60 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Faça login na aba <strong className="text-foreground">Nuvem</strong> para conectar contas e
              agendar publicações.
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
                    <Instagram className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      placeholder="@suapagina para preparar"
                      className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <button
                    onClick={onAddAccount}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground"
                  >
                    <Plus className="size-4" /> Add
                  </button>
                </div>

                <ul className="mt-3 flex flex-col gap-2">
                  {accounts.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/35 bg-primary/12 text-primary">
                        <Instagram className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">@{a.username}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {a.status === "connected" || a.status === "conectado"
                            ? `conectada via ${a.provider}`
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
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />}
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
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.caption}</p>
                              )}
                              {p.error && <p className="mt-1 text-xs text-red-400">{p.error}</p>}
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                                STATUS_STYLE[p.status] ?? "border-border text-muted-foreground"
                              }`}
                            >
                              {STATUS_LABEL[p.status] ?? p.status}
                            </span>
                          </div>
                          <div className="mt-2 flex justify-end gap-2">
                            {p.status === "agendado" && (
                              <button
                                onClick={async () => {
                                  await cancelPost(p.id);
                                  await refresh();
                                }}
                                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground transition hover:text-foreground"
                              >
                                <X className="size-3" /> cancelar
                              </button>
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
    </div>
  );
}
