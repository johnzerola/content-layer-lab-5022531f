import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Pencil, Radio, Scissors, Sparkles, Square, Trash2 } from "lucide-react";
import { AppShell, type AppMode } from "@/components/AppShell";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import { CloudPanel } from "@/components/CloudPanel";
import { listJobs } from "@/lib/jobs";
import type { Template } from "@/lib/template";
import { checkXLive, type LiveCheck } from "@/lib/live.functions";
import { LiveClipper, analyzeLiveClip, attachHls, clipTitle, type LiveClip } from "@/lib/live";
import { markPendingTool, sendItemsToTool } from "@/lib/handoff";
import { downloadAsZip } from "@/lib/zip";
import { listPosts, STATUS_LABEL, type ScheduledPost } from "@/lib/social";
import { currentUser, onAuth, type CloudUser } from "@/lib/cloud";

export const Route = createFileRoute("/live")({
  component: LivePage,
  head: () => ({
    meta: [
      { title: "Monitora Live â€” cortes automÃ¡ticos de lives do X" },
      {
        name: "description",
        content:
          "Monitore transmissÃµes pÃºblicas do X, Kick, TikTok ou HLS direto, gere cortes automÃ¡ticos pontuados por energia de fala e edite cada corte antes de baixar.",
      },
      { property: "og:title", content: "Monitora Live â€” cortes automÃ¡ticos de lives" },
      {
        property: "og:description",
        content: "Acompanhe uma live do X e receba cortes prontos, com score e editor de recorte.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type Status = "parado" | "procurando" | "ao-vivo" | "gravando";

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ScoreRing({ value }: { value: number }) {
  const c = 2 * Math.PI * 18;
  const tone =
    value >= 75 ? "text-emerald-400" : value >= 55 ? "text-primary" : "text-muted-foreground";
  return (
    <span className="relative grid size-12 shrink-0 place-items-center">
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90">
        <circle cx="22" cy="22" r="18" className="stroke-border" strokeWidth="4" fill="none" />
        <circle
          cx="22"
          cy="22"
          r="18"
          className={`${tone} stroke-current`}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
        />
      </svg>
      <span className={`font-mono text-[11px] font-bold ${tone}`}>{value}</span>
    </span>
  );
}

function LivePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AppMode>("external");
  const [libOpen, setLibOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const jobs = listJobs();
  const [target, setTarget] = useState("");
  const [clipLen, setClipLen] = useState(45);
  const [minScore, setMinScore] = useState(65);
  const [poll, setPoll] = useState(60);
  const [status, setStatus] = useState<Status>("parado");
  const [info, setInfo] = useState<LiveCheck | null>(null);
  const [clips, setClips] = useState<LiveClip[]>([]);
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<CloudUser | null>(null);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const clipperRef = useRef<LiveClipper | null>(null);
  const pollRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const indexRef = useRef(0);

  const teardown = useCallback(() => {
    runningRef.current = false;
    clipperRef.current?.stop();
    clipperRef.current = null;
    detachRef.current?.();
    detachRef.current = null;
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const refreshPosts = useCallback(async () => {
    setLoadingPosts(true);
    try {
      const p = await listPosts();
      setPosts(p);
    } catch (e) {
      console.error("Falha ao carregar posts na Live:", e);
    } finally {
      setLoadingPosts(false);
    }
  }, []);

  useEffect(() => {
    void currentUser().then(setUser);
    return onAuth(setUser);
  }, []);

  useEffect(() => {
    if (user) void refreshPosts();
    else setPosts([]);
  }, [user, refreshPosts]);

  const postStats = useMemo(() => {
    const total = posts.length;
    const published = posts.filter((p) => p.status === "publicado").length;
    const pending = posts.filter((p) => p.status === "agendado" || p.status === "processando").length;
    return { total, published, pending };
  }, [posts]);

  const onClipReady = useCallback(async (blob: Blob, at: number, duration: number) => {
    const analysis = await analyzeLiveClip(blob, duration);
    const id = crypto.randomUUID();
    setClips((prev) => [
      {
        id,
        blob,
        url: URL.createObjectURL(blob),
        at,
        duration,
        score: analysis.score,
        title: clipTitle(at, indexRef.current++),
        reason: analysis.reason,
        tags: analysis.tags,
        trim: analysis.trim,
      },
      ...prev,
    ]);
  }, []);

  const orderedClips = useMemo(() => [...clips].sort((a, b) => b.score - a.score), [clips]);
  const recommendedClips = useMemo(
    () => orderedClips.filter((clip) => clip.score >= minScore),
    [orderedClips, minScore],
  );

  function editInCorteIA(selected: LiveClip[]) {
    if (!selected.length) {
      toast.info("Nenhum corte atingiu o score atual. Reduza o score mÃ­nimo ou escolha um corte.");
      return;
    }
    sendItemsToTool(
      "clip",
      selected.map((clip) => ({
        file: new File(
          [clip.blob],
          `${clip.title.replace(/[^\w-]+/g, "_")}.${clip.blob.type.includes("mp4") ? "mp4" : "webm"}`,
          { type: clip.blob.type || "video/webm" },
        ),
        clip: clip.trim ?? { start: 0, end: clip.duration },
        score: clip.score,
        clipTitle: clip.title,
        ...(clip.reason ? { clipReason: clip.reason } : {}),
        ...(clip.tags ? { clipTags: clip.tags } : {}),
      })),

      "Monitora Live",
    );
    markPendingTool("clip");
    void navigate({ to: "/" });
  }

  const startCapture = useCallback(
    async (hls: string) => {
      const video = videoRef.current;
      if (!video) return;
      detachRef.current?.();
      detachRef.current = await attachHls(video, hls);

      const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream })
        .captureStream;
      if (!capture) {
        toast.error("Este navegador nÃ£o permite gravar a live (use Chrome ou Edge).");
        return;
      }
      const stream = capture.call(video);
      const clipper = new LiveClipper(stream, {
        clipLen,
        onClip: (b, at, dur) => void onClipReady(b, at, dur),
        onError: (m) => toast.error(m),
      });
      clipperRef.current = clipper;
      clipper.start();
      setStatus("gravando");
    },
    [clipLen, onClipReady],
  );

  const check = useCallback(async () => {
    const res = await checkXLive({ data: { target } });
    setInfo(res);
    if (res.live && res.hls && !clipperRef.current && runningRef.current) {
      setStatus("ao-vivo");
      await startCapture(res.hls);
      toast.success("Live encontrada â€” cortando automaticamente.");
    } else if (!res.live) {
      setStatus(runningRef.current ? "procurando" : "parado");
    }
  }, [target, startCapture]);

  async function start() {
    if (!target.trim()) {
      toast.error("Informe o @ do perfil ou o link da live.");
      return;
    }
    runningRef.current = true;
    setStatus("procurando");
    setBusy(true);
    try {
      await check();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao verificar a live.");
    } finally {
      setBusy(false);
    }
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(
      () => {
        if (!clipperRef.current) void check().catch(() => undefined);
      },
      Math.max(20, poll) * 1000,
    );
  }

  function stop() {
    teardown();
    setStatus("parado");
    toast("Monitoramento parado.");
  }

  function removeClip(id: string) {
    setClips((prev) => {
      const found = prev.find((c) => c.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter((c) => c.id !== id);
    });
  }

  async function downloadAll() {
    if (!clips.length) return;
    setBusy(true);
    try {
      await downloadAsZip(
        clips.map((c) => ({ name: `${c.title.replace(/[^\w-]+/g, "_")}.webm`, blob: c.blob })),
        "monitora-live.zip",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar o ZIP.");
    } finally {
      setBusy(false);
    }
  }

  const statusChip: Record<Status, string> = {
    parado: "border-border bg-surface-2 text-muted-foreground",
    procurando: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    "ao-vivo": "border-primary/40 bg-primary/12 text-primary",
    gravando: "border-red-500/40 bg-red-500/10 text-red-400",
  };

  return (
    <AppShell
      mode={mode}
      onMode={setMode}
      count={jobs.length}
      onLibrary={() => setLibOpen(true)}
      onCloud={() => setCloudOpen(true)}
    >
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex items-center justify-between gap-3 lg:col-span-2">
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold tracking-tight">
              Monitora Live
            </h1>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              cortes automaticos de X, Kick, TikTok e HLS
            </p>
          </div>
          <span
            className={`rounded-full border px-3 py-1 font-mono text-[11px] ${statusChip[status]}`}
          >
            {status}
          </span>
        </div>
        <section className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <video
              ref={videoRef}
              muted
              playsInline
              controls
              className="aspect-video w-full bg-black"
            />
            <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-4 py-3">
              <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <Radio className="size-3.5" />
                {info?.title ??
                  (info?.handle
                    ? `${info.platform === "kick" ? "Kick" : info.platform === "tiktok" ? "TikTok" : "X"} Â· @${info.handle}`
                    : "aguardando transmissÃ£o")}
              </span>
              <button
                onClick={() => clipperRef.current?.cutNow()}
                disabled={!clipperRef.current}
                className="ml-auto flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm transition hover:bg-surface-2 disabled:opacity-40"
              >
                <Scissors className="size-4" /> cortar agora
              </button>
            </div>
          </div>

          {info?.message && (
            <p className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted-foreground">
              {info.message}
            </p>
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold">Cortes ({clips.length})</h2>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {recommendedClips.length} recomendado(s), ordenados por potencial
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => editInCorteIA(recommendedClips)}
                  disabled={!recommendedClips.length}
                  className="flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
                >
                  <Sparkles className="size-4" /> editar melhores no CorteIA
                </button>
                <button
                  onClick={() => void downloadAll()}
                  disabled={!clips.length || busy}
                  className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm transition hover:bg-surface-2 disabled:opacity-40"
                >
                  <Download className="size-4" /> ZIP
                </button>
              </div>
            </div>

            {!clips.length && (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Os cortes aparecem aqui automaticamente enquanto a live estiver no ar.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {orderedClips.map((c) => (
                <article
                  key={c.id}
                  className={`rounded-2xl border bg-surface p-3 ${
                    c.score >= minScore ? "border-primary/50" : "border-border"
                  }`}
                >
                  <video
                    src={c.url}
                    controls
                    onLoadedMetadata={(event) => {
                      event.currentTarget.currentTime = c.trim?.start ?? 0;
                    }}
                    onTimeUpdate={(event) => {
                      if (c.trim && event.currentTarget.currentTime >= c.trim.end)
                        event.currentTarget.pause();
                    }}
                    className="aspect-video w-full rounded-xl bg-black"
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <ScoreRing value={c.score} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {fmt(c.at)} Â·{" "}
                        {Math.round((c.trim?.end ?? c.duration) - (c.trim?.start ?? 0))}s Ãºteis
                      </p>
                    </div>
                  </div>
                  {c.reason && <p className="mt-2 text-xs text-muted-foreground">{c.reason}</p>}
                  {c.tags && c.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {c.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => editInCorteIA([c])}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-sm transition hover:bg-surface-2"
                    >
                      <Pencil className="size-4" /> editar no CorteIA
                    </button>
                    <a
                      href={c.url}
                      download={`${c.title.replace(/[^\w-]+/g, "_")}.webm`}
                      className="rounded-xl border border-border px-3 py-2 text-sm transition hover:bg-surface-2"
                    >
                      <Download className="size-4" />
                    </a>
                    <button
                      onClick={() => removeClip(c.id)}
                      className="rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:bg-surface-2"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <p className="mono-label">TransmissÃ£o</p>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="x:@perfil, kick:canal, tiktok:@perfil, URL da live ou .m3u8"
              className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <label className="block text-sm">
              <span className="mono-label">duraÃ§Ã£o do corte: {clipLen}s</span>
              <input
                type="range"
                min={15}
                max={120}
                step={5}
                value={clipLen}
                onChange={(e) => setClipLen(Number(e.target.value))}
                className="mt-2 w-full accent-[var(--primary)]"
              />
            </label>
            <label className="block text-sm">
              <span className="mono-label">score mÃ­nimo recomendado: {minScore}</span>
              <input
                type="range"
                min={40}
                max={90}
                step={5}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="mt-2 w-full accent-[var(--primary)]"
              />
            </label>
            <label className="block text-sm">
              <span className="mono-label">verificar a cada: {poll}s</span>
              <input
                type="range"
                min={20}
                max={300}
                step={10}
                value={poll}
                onChange={(e) => setPoll(Number(e.target.value))}
                className="mt-2 w-full accent-[var(--primary)]"
              />
            </label>

            {status === "parado" ? (
              <button
                onClick={() => void start()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}{" "}
                monitorar
              </button>
            ) : (
              <button
                onClick={stop}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-2"
              >
                <Square className="size-4" /> parar
              </button>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="mono-label">PublicaÃ§Ãµes</p>
              {loadingPosts && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl border border-border bg-surface-2 p-2">
                <span className="block text-lg font-bold text-primary">{postStats.published}</span>
                <span className="font-mono text-[9px] uppercase text-muted-foreground">feitas</span>
              </div>
              <div className="rounded-xl border border-border bg-surface-2 p-2">
                <span className="block text-lg font-bold text-amber-400">{postStats.pending}</span>
                <span className="font-mono text-[9px] uppercase text-muted-foreground">aguardando</span>
              </div>
            </div>
            
            {posts.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {posts.slice(0, 10).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-surface-2/50 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[10px] text-foreground">
                        {new Date(p.scheduled_at).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] uppercase ${
                      p.status === 'publicado' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
                      p.status === 'falhou' ? 'border-red-500/30 bg-red-500/10 text-red-400' :
                      'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    }`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-center font-mono text-[10px] text-muted-foreground">nenhum agendamento</p>
            )}
          </div>
              <button
                onClick={() => void start()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}{" "}
                monitorar
              </button>
            ) : (
              <button
                onClick={stop}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-2"
              >
                <Square className="size-4" /> parar
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted-foreground">
            <p className="mono-label mb-2">como funciona</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>O sistema procura live pÃºblica no X, Kick, TikTok ou HLS direto.</li>
              <li>Ao encontrar, comeÃ§a a gravar e fecha um corte a cada {clipLen}s.</li>
              <li>Fala, ruÃ­do, pausas, ritmo e comeÃ§o/fim limpos formam o score.</li>
              <li>
                Os melhores cortes seguem para o CorteIA, onde podem ser ajustados e exportados.
              </li>
            </ol>
          </div>
        </aside>
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
