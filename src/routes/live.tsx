import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Loader2,
  Radio,
  Scissors,
  Square,
  Trash2,
} from "lucide-react";
import { AppShell, type AppMode } from "@/components/AppShell";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import { CloudPanel } from "@/components/CloudPanel";
import { listJobs } from "@/lib/jobs";
import type { Template } from "@/lib/template";
import { checkXLive, type LiveCheck } from "@/lib/live.functions";
import {
  LiveClipper,
  attachHls,
  clipTitle,
  exportClip,
  scoreClip,
  type LiveClip,
} from "@/lib/live";
import { downloadAsZip } from "@/lib/zip";

export const Route = createFileRoute("/live")({
  component: LivePage,
  head: () => ({
    meta: [
      { title: "Monitora Live — cortes automáticos de lives do X" },
      {
        name: "description",
        content:
          "Monitore transmissões públicas do X, Kick, TikTok ou HLS direto, gere cortes automáticos pontuados por energia de fala e edite cada corte antes de baixar.",
      },
      { property: "og:title", content: "Monitora Live — cortes automáticos de lives" },
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
  const tone = value >= 75 ? "text-emerald-400" : value >= 55 ? "text-primary" : "text-muted-foreground";
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
  const [mode, setMode] = useState<AppMode>("lote");
  const [libOpen, setLibOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const jobs = listJobs();

  const [target, setTarget] = useState("");
  const [clipLen, setClipLen] = useState(45);
  const [poll, setPoll] = useState(60);
  const [status, setStatus] = useState<Status>("parado");
  const [info, setInfo] = useState<LiveCheck | null>(null);
  const [clips, setClips] = useState<LiveClip[]>([]);
  const [editing, setEditing] = useState<LiveClip | null>(null);
  const [busy, setBusy] = useState(false);

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

  const onClipReady = useCallback(async (blob: Blob, at: number, duration: number) => {
    const score = await scoreClip(blob);
    const id = crypto.randomUUID();
    setClips((prev) => [
      {
        id,
        blob,
        url: URL.createObjectURL(blob),
        at,
        duration,
        score,
        title: clipTitle(at, indexRef.current++),
      },
      ...prev,
    ]);
  }, []);

  const startCapture = useCallback(
    async (hls: string) => {
      const video = videoRef.current;
      if (!video) return;
      detachRef.current?.();
      detachRef.current = await attachHls(video, hls);

      const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
      if (!capture) {
        toast.error("Este navegador não permite gravar a live (use Chrome ou Edge).");
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
      toast.success("Live encontrada — cortando automaticamente.");
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
    pollRef.current = window.setInterval(() => {
      if (!clipperRef.current) void check().catch(() => undefined);
    }, Math.max(20, poll) * 1000);
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
                  ? `${info.platform === "kick" ? "Kick" : info.platform === "tiktok" ? "TikTok" : "X"} · @${info.handle}`
                  : "aguardando transmissão")}
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
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold">Cortes ({clips.length})</h2>
              <button
                onClick={() => void downloadAll()}
                disabled={!clips.length || busy}
                className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm transition hover:bg-surface-2 disabled:opacity-40"
              >
                <Download className="size-4" /> baixar todos (ZIP)
              </button>
            </div>

            {!clips.length && (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Os cortes aparecem aqui automaticamente enquanto a live estiver no ar.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {clips.map((c) => (
                <article key={c.id} className="rounded-2xl border border-border bg-surface p-3">
                  <video src={c.url} controls className="aspect-video w-full rounded-xl bg-black" />
                  <div className="mt-3 flex items-center gap-3">
                    <ScoreRing value={c.score} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.title}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {fmt(c.at)} · {Math.round(c.duration)}s
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setEditing(c)}
                      className="flex-1 rounded-xl border border-border px-3 py-2 text-sm transition hover:bg-surface-2"
                    >
                      editar
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
            <p className="mono-label">Transmissão</p>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="x:@perfil, kick:canal, tiktok:@perfil, URL da live ou .m3u8"
              className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
            <label className="block text-sm">
              <span className="mono-label">duração do corte: {clipLen}s</span>
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
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />} monitorar
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
              <li>O sistema procura live pública no X, Kick, TikTok ou HLS direto.</li>
              <li>Ao encontrar, começa a gravar e fecha um corte a cada {clipLen}s.</li>
              <li>Cada corte recebe um score por energia de fala e dinâmica.</li>
              <li>Você edita o recorte, escolhe vertical 9:16 e baixa.</li>
            </ol>
          </div>
        </aside>
      </main>

      {editing && (
        <ClipEditor
          clip={editing}
          onClose={() => setEditing(null)}
          onSaved={(blob) => {
            setClips((prev) =>
              prev.map((c) =>
                c.id === editing.id ? { ...c, blob, url: URL.createObjectURL(blob) } : c,
              ),
            );
            setEditing(null);
          }}
        />
      )}

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

function ClipEditor({
  clip,
  onClose,
  onSaved,
}: {
  clip: LiveClip;
  onClose: () => void;
  onSaved: (blob: Blob) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [dur, setDur] = useState(clip.duration);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(clip.duration);
  const [vertical, setVertical] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);

  async function save() {
    setProgress(0);
    try {
      const blob = await exportClip(clip.blob, {
        start,
        end,
        vertical,
        onProgress: setProgress,
      });
      onSaved(blob);
      toast.success("Corte exportado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar o corte.");
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-3xl space-y-4 rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-base font-bold">{clip.title}</h3>
          <button onClick={onClose} className="ml-auto text-sm text-muted-foreground hover:text-foreground">
            fechar
          </button>
        </div>

        <video
          ref={videoRef}
          src={clip.url}
          controls
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) {
              setDur(d);
              setEnd(d);
            }
          }}
          className={`w-full rounded-xl bg-black ${vertical ? "aspect-[9/16] object-cover" : "aspect-video"}`}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mono-label">início: {start.toFixed(1)}s</span>
            <input
              type="range"
              min={0}
              max={Math.max(0.5, dur - 0.5)}
              step={0.1}
              value={start}
              onChange={(e) => {
                const v = Math.min(Number(e.target.value), end - 0.5);
                setStart(v);
                if (videoRef.current) videoRef.current.currentTime = v;
              }}
              className="mt-2 w-full accent-[var(--primary)]"
            />
          </label>
          <label className="text-sm">
            <span className="mono-label">fim: {end.toFixed(1)}s</span>
            <input
              type="range"
              min={0.5}
              max={dur}
              step={0.1}
              value={end}
              onChange={(e) => setEnd(Math.max(Number(e.target.value), start + 0.5))}
              className="mt-2 w-full accent-[var(--primary)]"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={vertical}
            onChange={(e) => setVertical(e.target.checked)}
            className="accent-[var(--primary)]"
          />
          exportar vertical 9:16 (Reels / TikTok / Shorts)
        </label>

        <button
          onClick={() => void save()}
          disabled={progress !== null}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {progress !== null ? (
            <>
              <Loader2 className="size-4 animate-spin" /> exportando {Math.round(progress * 100)}%
            </>
          ) : (
            <>
              <Scissors className="size-4" /> aplicar corte
            </>
          )}
        </button>
      </div>
    </div>
  );
}
