import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Link as LinkIcon,
  Scissors,
  X,
  Play,
  Download,
  Pencil,
  Repeat,
  Library,
  Save,
  Pause,
  StopCircle,
  RotateCcw,
  FolderDown,
  FileArchive,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateCanvas } from "@/components/TemplateCanvas";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import {
  applyRatio,
  commitTemplate,
  createTemplate,
  loadTemplates,
  RATIO_PRESETS,
  type Template,
} from "@/lib/template";
import { downloadBlob, grabPoster, renderVideo } from "@/lib/render";
import { webCodecsSupported } from "@/lib/encode";
import { defaultAntiDup, describeVariation, makeVariation } from "@/lib/variation";
import { autoFrame } from "@/lib/autoframe";
import { findClips, formatTime } from "@/lib/clips";
import { resolveVideoLink } from "@/lib/import.functions";
import { downloadAsZip, fsAccessSupported, saveToFolder } from "@/lib/zip";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VaiViral — Editor de vídeos em lote para Reels, TikTok e Shorts" },
      {
        name: "description",
        content:
          "Crie um template com avatar, nome, headline, CTA e marca d'água, importe centenas de vídeos e processe tudo em lote no navegador.",
      },
      { property: "og:title", content: "VaiViral — Editor de vídeos em lote 9:16" },
      {
        property: "og:description",
        content: "Template visual estilo Canva, importação em massa, anti-duplicidade e download de todos os vídeos prontos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

type Status = "pendente" | "na fila" | "processando" | "pronto" | "erro";

interface Item {
  id: string;
  file: File;
  poster: string | null;
  w: number;
  h: number;
  duration: number;
  headline: string;
  offsetX: number;
  offsetY: number;
  autoFrameSource?: string | undefined;
  clip?: { start: number; end: number } | undefined;
  score?: number | undefined;
  status: Status;
  progress: number;
  blob?: Blob | undefined;
  ext?: string | undefined;
  error?: string | undefined;
}

interface QueueCtrl {
  paused: boolean;
  cancelled: boolean;
  aborts: Map<string, AbortController>;
}

function Home() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [active, setActive] = useState<Template>(() => createTemplate("Padrão"));
  const [editing, setEditing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [bitrate, setBitrate] = useState(10);
  const [smartFrame, setSmartFrame] = useState(true);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [clipBusy, setClipBusy] = useState(false);
  const [clipLen, setClipLen] = useState(30);
  const [clipMax, setClipMax] = useState(6);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const ctrlRef = useRef<QueueCtrl>({ paused: false, cancelled: false, aborts: new Map() });
  const itemsRef = useRef<Item[]>([]);
  const startedAt = useRef(0);
  const doneCount = useRef(0);
  const smartRef = useRef(smartFrame);

  itemsRef.current = items;
  smartRef.current = smartFrame;

  const commit = useCallback((t: Template, note?: string) => {
    setTemplates((list) => {
      const res = commitTemplate(list, t, note);
      setActive(res.template);
      return res.list;
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }, []);


  useEffect(() => {
    const list = loadTemplates();
    setTemplates(list);
    if (list[0]) setActive(list[0]);
  }, []);

  const addVideos = useCallback(async (list: File[]) => {
    const vids = list.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(f.name));
    const created: Item[] = vids.map((file) => ({
      id: crypto.randomUUID(),
      file,
      poster: null,
      w: 0,
      h: 0,
      duration: 0,
      headline: "",
      offsetX: 0,
      offsetY: 0,
      status: "pendente",
      progress: 0,
    }));
    setItems((prev) => [...prev, ...created]);
    setSelectedId((cur) => cur ?? created[0]?.id ?? null);
    for (const it of created) {
      try {
        const meta = await grabPoster(it.file);
        setItems((prev) =>
          prev.map((p) => (p.id === it.id ? { ...p, poster: meta.url, w: meta.w, h: meta.h, duration: meta.duration } : p)),
        );
        if (smartRef.current) {
          const af = await autoFrame(it.file);
          setItems((prev) =>
            prev.map((p) =>
              p.id === it.id ? { ...p, offsetX: af.offsetX, offsetY: af.offsetY, autoFrameSource: af.source } : p,
            ),
          );
        }
      } catch {
        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "erro" } : p)));
      }
    }
  }, []);

  const addFiles = useCallback(
    (files: FileList | null) => (files ? addVideos(Array.from(files)) : Promise.resolve()),
    [addVideos],
  );

  /** Importa um vídeo apenas colando o link (baixa pelo servidor, sem upload). */
  const importFromLink = useCallback(async () => {
    const url = linkUrl.trim();
    if (!url || linkBusy) return;
    setLinkBusy(true);
    setLinkMsg("procurando o vídeo...");
    try {
      const res = await resolveVideoLink({ data: { url } });
      if (!res.ok || !res.videoUrl) {
        setLinkMsg(res.message ?? "não encontrei o vídeo nesse link");
        return;
      }
      setLinkMsg(`baixando de ${res.source ?? "origem"}...`);
      const dl = await fetch(`/api/public/media-proxy?u=${encodeURIComponent(res.videoUrl)}`);
      if (!dl.ok) {
        setLinkMsg("a origem bloqueou o download desse arquivo");
        return;
      }
      const blob = await dl.blob();
      const base = (res.title ?? "video").replace(/[^\w\-. ]+/g, "").slice(0, 60) || "video";
      const file = new File([blob], `${base}.mp4`, { type: blob.type || "video/mp4" });
      await addVideos([file]);
      setLinkMsg(`importado: ${file.name} (${(file.size / 1e6).toFixed(1)} MB)`);
      setLinkUrl("");
    } catch (err) {
      setLinkMsg(String((err as Error)?.message ?? err));
    } finally {
      setLinkBusy(false);
    }
  }, [linkUrl, linkBusy, addVideos]);

  /** Clipagem automática: quebra um vídeo longo nos melhores trechos. */
  const autoClip = useCallback(
    async (item: Item) => {
      if (clipBusy) return;
      setClipBusy(true);
      try {
        const clips = await findClips(item.file, { target: clipLen, max: clipMax });
        const created: Item[] = clips.map((c) => ({
          id: crypto.randomUUID(),
          file: item.file,
          poster: item.poster,
          w: item.w,
          h: item.h,
          duration: c.end - c.start,
          headline: item.headline,
          offsetX: item.offsetX,
          offsetY: item.offsetY,
          clip: { start: c.start, end: c.end },
          score: c.score,
          status: "pendente" as Status,
          progress: 0,
          ...(item.autoFrameSource ? { autoFrameSource: item.autoFrameSource } : {}),
        }));
        setItems((prev) => [...prev.filter((p) => p.id !== item.id), ...created]);
        setSelectedId(created[0]?.id ?? null);
      } catch (err) {
        setLinkMsg(`falha na clipagem: ${String((err as Error)?.message ?? err)}`);
      } finally {
        setClipBusy(false);
      }
    },
    [clipBusy, clipLen, clipMax],
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;

  const antiDup = active.antiDup ?? defaultAntiDup();
  const setAntiDup = (patch: Partial<typeof antiDup>) =>
    setActive((t) => ({ ...t, antiDup: { ...(t.antiDup ?? defaultAntiDup()), ...patch } }));

  const variationOf = useCallback(
    (item: Item) =>
      makeVariation(
        { ...(active.antiDup ?? defaultAntiDup()), mirror: active.mirror, speed: active.speed },
        `${item.file.name}:${item.file.size}:${item.id}`,
      ),
    [active],
  );

  const processAll = async (onlyIds?: string[]) => {
    const ctrl = ctrlRef.current;
    ctrl.paused = false;
    ctrl.cancelled = false;
    setPaused(false);
    setRunning(true);
    startedAt.current = performance.now();
    doneCount.current = 0;

    const pending = items
      .filter((i) => (onlyIds ? onlyIds.includes(i.id) : i.status !== "pronto"))
      .map((i) => i.id);
    const queue = [...pending];
    setItems((p) => p.map((x) => (queue.includes(x.id) ? { ...x, status: "na fila", progress: 0 } : x)));

    const worker = async () => {
      while (queue.length) {
        while (ctrl.paused && !ctrl.cancelled) await new Promise((r) => setTimeout(r, 200));
        if (ctrl.cancelled) return;
        const id = queue.shift();
        if (!id) return;
        const item = itemsRef.current.find((x) => x.id === id);
        if (!item) continue;
        const ac = new AbortController();
        ctrl.aborts.set(id, ac);
        setItems((p) => p.map((x) => (x.id === id ? { ...x, status: "processando", progress: 0 } : x)));
        try {
          const { blob, ext } = await renderVideo(item.file, active, {
            variation: variationOf(item),
            offsetX: item.offsetX,
            offsetY: item.offsetY,
            headline: item.headline || undefined,
            bitrate: bitrate * 1_000_000,
            clip: item.clip,
            signal: ac.signal,
            onProgress: (p) => setItems((prev) => prev.map((x) => (x.id === id ? { ...x, progress: p } : x))),
          });
          doneCount.current++;
          setItems((p) => p.map((x) => (x.id === id ? { ...x, status: "pronto", blob, ext, progress: 1 } : x)));
        } catch (err) {
          const aborted = (err as Error)?.name === "AbortError";
          setItems((p) =>
            p.map((x) =>
              x.id === id
                ? { ...x, status: aborted ? "pendente" : "erro", error: aborted ? undefined : String((err as Error)?.message ?? err) }
                : x,
            ),
          );
        } finally {
          ctrl.aborts.delete(id);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    setRunning(false);
  };

  const togglePause = () => {
    ctrlRef.current.paused = !ctrlRef.current.paused;
    setPaused(ctrlRef.current.paused);
  };

  const cancelAll = () => {
    ctrlRef.current.cancelled = true;
    ctrlRef.current.paused = false;
    ctrlRef.current.aborts.forEach((a) => a.abort());
    ctrlRef.current.aborts.clear();
    setPaused(false);
    setRunning(false);
    setItems((p) => p.map((x) => (x.status === "processando" || x.status === "na fila" ? { ...x, status: "pendente" } : x)));
  };

  const retryErrors = () => {
    const ids = items.filter((i) => i.status === "erro").map((i) => i.id);
    if (ids.length) void processAll(ids);
  };

  const readyCount = items.filter((i) => i.status === "pronto").length;
  const errorCount = items.filter((i) => i.status === "erro").length;
  const pendingCount = items.filter((i) => i.status !== "pronto").length;

  const eta = (() => {
    if (!running || doneCount.current === 0) return null;
    const per = (performance.now() - startedAt.current) / doneCount.current;
    const left = (per * pendingCount) / Math.max(1, concurrency);
    const s = Math.round(left / 1000);
    return s > 90 ? `${Math.round(s / 60)} min` : `${s}s`;
  })();

  const outFiles = () =>
    items
      .filter((i) => i.blob)
      .map((i, idx) => ({
        name: `${active.name.replace(/\s+/g, "-").toLowerCase()}-${String(idx + 1).padStart(3, "0")}.${i.ext}`,
        blob: i.blob!,
      }));

  const downloadZipAll = async () => {
    setZipping(true);
    try {
      await downloadAsZip(outFiles(), `${active.name.replace(/\s+/g, "-").toLowerCase()}.zip`);
    } finally {
      setZipping(false);
    }
  };

  const saveFolder = async () => {
    try {
      await saveToFolder(outFiles());
    } catch {
      /* cancelado */
    }
  };


  const previewTemplate: Template = selected
    ? {
        ...active,
        headline: { ...active.headline, text: selected.headline || active.headline.text },
        video: { ...active.video, offsetX: selected.offsetX, offsetY: selected.offsetY },
      }
    : active;

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary font-mono text-sm font-bold text-primary-foreground">
              vv
            </div>
            <div>
              <h1 className="font-mono text-sm tracking-[0.2em] text-foreground">VAIVIRAL</h1>
              <p className="font-mono text-[10px] text-muted-foreground">
                editor em lote · 9:16 · roda no navegador
              </p>
            </div>
          </div>
          <span className="rounded-full border border-primary/40 bg-accent px-3 py-1 font-mono text-[11px] text-accent-foreground">
            ● {items.length} vídeo{items.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-5 px-5 py-6">
        <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="mono-label">Template ativo</p>
            <p className="text-lg font-semibold">{active.name}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              v{active.version ?? 1}
              {templates.some((t) => t.id === active.id) ? "" : " · não salvo"}
              {savedFlash && <span className="ml-2 text-primary">● salvo</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {templates.length > 0 && (
              <select
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                value={templates.some((t) => t.id === active.id) ? active.id : ""}
                onChange={(e) => {
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t) setActive(t);
                }}
              >
                <option value="" disabled>
                  Meus templates
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · v{t.version ?? 1}
                  </option>
                ))}
              </select>
            )}
            <select
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
              value={`${active.canvasW ?? 1080}x${active.canvasH ?? 1920}`}
              onChange={(e) => {
                const p = RATIO_PRESETS.find((r) => `${r.w}x${r.h}` === e.target.value);
                if (p) setActive(applyRatio(active, p.w, p.h));
              }}
            >
              {RATIO_PRESETS.map((r) => (
                <option key={r.id} value={`${r.w}x${r.h}`}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => setActive(createTemplate("Novo template"))}>
              Novo
            </Button>

            <Button variant="outline" onClick={() => setLibraryOpen(true)}>
              <Library className="size-4" /> Biblioteca
            </Button>
            <Button variant="outline" onClick={() => commit(active, "salvo manualmente")}>
              <Save className="size-4" /> Salvar versão
            </Button>
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Editar template
            </Button>
          </div>
        </section>


        <section
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
          className="panel border-dashed p-10 text-center"
        >
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent">
            <Upload className="size-5 text-primary" />
          </div>
          <p className="mt-4 text-lg font-semibold">
            <span className="step-num mr-2">02</span>Solta os vídeos aqui
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            clique ou arraste · mp4 · mov · webm · vários de uma vez
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              Selecionar arquivos
            </Button>
            <Button variant="outline" onClick={() => folderRef.current?.click()}>
              Selecionar pasta
            </Button>
          </div>
          <input ref={inputRef} type="file" accept="video/*" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
          <input
            ref={folderRef}
            type="file"
            multiple
            hidden
            // @ts-expect-error atributo não tipado
            webkitdirectory=""
            onChange={(e) => void addFiles(e.target.files)}
          />

          <div className="mx-auto mt-6 max-w-xl border-t border-border pt-5">
            <p className="mono-label">ou cole o link do vídeo</p>
            <div className="mt-2 flex gap-2">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void importFromLink()}
                placeholder="https://... link da página ou do arquivo .mp4"
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs outline-none focus:border-primary"
              />
              <Button onClick={() => void importFromLink()} disabled={linkBusy || !linkUrl.trim()}>
                <LinkIcon className="mr-1 size-4" />
                {linkBusy ? "baixando..." : "Importar"}
              </Button>
            </div>
            {linkMsg && <p className="mt-2 font-mono text-[11px] text-muted-foreground">{linkMsg}</p>}
          </div>
        </section>

        {items.length > 0 && (
          <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
            <section className="panel space-y-4 p-5">
              <div>
                <p className="text-lg font-semibold">
                  <span className="step-num mr-2">03</span>Preview & ajuste individual
                </p>
                <p className="text-sm text-muted-foreground">
                  Reposicione o enquadramento quando o corte automático errar.
                </p>
              </div>
              {selected ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="mono-label">Original</p>
                    {selected.poster ? (
                      <img src={selected.poster} alt="quadro original" className="w-full rounded-xl border border-border" />
                    ) : (
                      <div className="grid h-52 place-items-center rounded-xl border border-border text-xs text-muted-foreground">
                        carregando quadro…
                      </div>
                    )}
                    <div className="space-y-2 pt-1">
                      <input
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                        placeholder="Headline só deste vídeo (opcional)"
                        value={selected.headline}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.id === selected.id ? { ...x, headline: e.target.value } : x)))
                        }
                      />
                      {(["offsetX", "offsetY"] as const).map((axis) => (
                        <label key={axis} className="block text-xs text-muted-foreground">
                          Corte {axis === "offsetX" ? "horizontal" : "vertical"}
                          <input
                            type="range"
                            min={-1}
                            max={1}
                            step={0.02}
                            value={selected[axis]}
                            onChange={(e) =>
                              setItems((p) =>
                                p.map((x) => (x.id === selected.id ? { ...x, [axis]: Number(e.target.value) } : x)),
                              )
                            }
                            className="w-full accent-[var(--primary)]"
                          />
                        </label>
                      ))}
                      <button
                        className="flex items-center gap-1.5 font-mono text-xs text-primary"
                        onClick={() =>
                          setItems((p) => p.map((x) => (x.id === selected.id ? { ...x, offsetX: 0, offsetY: 0 } : x)))
                        }
                      >
                        <Repeat className="size-3" /> restaurar auto
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="mono-label">Preview final</p>
                    <TemplateCanvas template={previewTemplate} interactive={false} poster={selected.poster} previewFile={selected.file} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Selecione um vídeo na lista.</p>
              )}

              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void processAll()} disabled={running}>
                    <Play className="size-4" /> {running ? "Processando…" : "Processar em lote"}
                  </Button>
                  {running && (
                    <>
                      <Button variant="outline" onClick={togglePause}>
                        <Pause className="size-4" /> {paused ? "Retomar" : "Pausar"}
                      </Button>
                      <Button variant="outline" onClick={cancelAll}>
                        <StopCircle className="size-4" /> Cancelar
                      </Button>
                    </>
                  )}
                  {errorCount > 0 && !running && (
                    <Button variant="outline" onClick={retryErrors}>
                      <RotateCcw className="size-4" /> Tentar de novo ({errorCount})
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => void downloadZipAll()} disabled={readyCount === 0 || zipping}>
                    <FileArchive className="size-4" /> {zipping ? "Compactando…" : `Baixar ZIP (${readyCount})`}
                  </Button>
                  {fsAccessSupported() && (
                    <Button variant="outline" onClick={() => void saveFolder()} disabled={readyCount === 0}>
                      <FolderDown className="size-4" /> Salvar na pasta
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted-foreground">
                  <label className="flex items-center gap-2">
                    paralelo
                    <input
                      type="range"
                      min={1}
                      max={4}
                      value={concurrency}
                      disabled={running}
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                      className="w-24 accent-[var(--primary)]"
                    />
                    {concurrency}x
                  </label>
                  <label className="flex items-center gap-2">
                    bitrate
                    <input
                      type="range"
                      min={4}
                      max={20}
                      value={bitrate}
                      disabled={running}
                      onChange={(e) => setBitrate(Number(e.target.value))}
                      className="w-24 accent-[var(--primary)]"
                    />
                    {bitrate} Mbps
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={smartFrame}
                      onChange={(e) => setSmartFrame(e.target.checked)}
                      className="accent-[var(--primary)]"
                    />
                    <Sparkles className="size-3" /> enquadramento inteligente
                  </label>
                  <span>{webCodecsSupported() ? "MP4 H.264 · WebCodecs" : "WebM (fallback)"}</span>
                  {eta && <span className="text-primary">● restam ~{eta}</span>}
                </div>

                {selected && (
                  <div className="rounded-xl border border-border bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="mono-label">Cortes automáticos</p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={clipBusy}
                        onClick={() => void autoClip(selected)}
                      >
                        <Scissors className="mr-1 size-4" />
                        {clipBusy ? "analisando..." : "Gerar cortes"}
                      </Button>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="font-mono text-[11px] text-muted-foreground">
                        duração de cada corte · {clipLen}s
                        <input
                          type="range"
                          min={10}
                          max={90}
                          step={5}
                          value={clipLen}
                          onChange={(e) => setClipLen(Number(e.target.value))}
                          className="w-full accent-[var(--primary)]"
                        />
                      </label>
                      <label className="font-mono text-[11px] text-muted-foreground">
                        máximo de cortes · {clipMax}
                        <input
                          type="range"
                          min={1}
                          max={20}
                          step={1}
                          value={clipMax}
                          onChange={(e) => setClipMax(Number(e.target.value))}
                          className="w-full accent-[var(--primary)]"
                        />
                      </label>
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {selected.clip
                        ? `trecho ${formatTime(selected.clip.start)}–${formatTime(selected.clip.end)}${
                            selected.score ? ` · score ${selected.score}` : ""
                          }`
                        : "analisa áudio e movimento e separa os melhores trechos do vídeo longo"}
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="mono-label">Anti-duplicidade</p>
                    <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={antiDup.auto}
                        onChange={(e) => setAntiDup({ auto: e.target.checked })}
                        className="accent-[var(--primary)]"
                      />
                      randomizar por vídeo
                    </label>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["brightness", "brilho", 0.15],
                        ["saturation", "saturação", 0.2],
                        ["zoom", "zoom", 0.12],
                        ["trim", "corte início/fim (s)", 1],
                        ["noise", "ruído", 0.12],
                      ] as const
                    ).map(([key, label, max]) => (
                      <label key={key} className="font-mono text-[11px] text-muted-foreground">
                        {label} · {key === "trim" ? `${antiDup[key].toFixed(2)}s` : `${(antiDup[key] * 100).toFixed(0)}%`}
                        <input
                          type="range"
                          min={0}
                          max={max}
                          step={max / 50}
                          value={antiDup[key]}
                          disabled={!antiDup.auto}
                          onChange={(e) => setAntiDup({ [key]: Number(e.target.value) })}
                          className="w-full accent-[var(--primary)]"
                        />
                      </label>
                    ))}
                  </div>
                  {selected && (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      este vídeo: {describeVariation(variationOf(selected))}
                    </p>
                  )}
                </div>

              </div>

            </section>

            <section className="panel flex max-h-[70vh] flex-col p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-semibold">Vídeos ({items.length})</p>
                <button
                  className="font-mono text-xs text-destructive"
                  onClick={() => {
                    setItems([]);
                    setSelectedId(null);
                  }}
                >
                  limpar todos
                </button>
              </div>
              <div className="space-y-2 overflow-y-auto pr-1">
                {items.map((it, i) => (
                  <button
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${
                      selectedId === it.id ? "border-primary bg-accent/40" : "border-border bg-surface-2"
                    }`}
                  >
                    {it.poster ? (
                      <img src={it.poster} alt="" className="h-14 w-10 rounded-md object-cover" />
                    ) : (
                      <div className="h-14 w-10 rounded-md bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-mono text-xs text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </span>{" "}
                        {it.file.name}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {it.w && it.h ? `${it.w}×${it.h}` : "…"} · {it.duration ? `${it.duration.toFixed(0)}s` : "…"}
                        {it.clip ? ` · corte ${formatTime(it.clip.start)}` : ""}
                        {it.score ? ` · ${it.score}` : ""}

                      </p>
                      <p
                        className={`font-mono text-[11px] ${
                          it.status === "pronto"
                            ? "text-primary"
                            : it.status === "erro"
                              ? "text-destructive"
                              : it.status === "processando"
                                ? "text-warn"
                                : "text-muted-foreground"
                        }`}
                      >
                        ● {it.status}
                        {it.status === "processando" ? ` ${Math.round(it.progress * 100)}%` : ""}
                      </p>
                    </div>
                    {it.blob && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadBlob(it.blob!, `${it.file.name.replace(/\.\w+$/, "")}-vv.${it.ext}`);
                        }}
                        className="rounded-md border border-border p-1.5 hover:border-primary"
                      >
                        <Download className="size-3.5" />
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setItems((p) => p.filter((x) => x.id !== it.id));
                      }}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        <footer className="py-8 text-center font-mono text-xs text-muted-foreground">
          tudo roda no navegador · nenhum vídeo sai da sua máquina
        </footer>
      </div>

      {editing && (
        <TemplateEditor
          value={active}
          onCancel={() => setEditing(false)}
          onUse={(t) => {
            setActive(t);
            setEditing(false);
          }}
          onSave={(t) => {
            commit(t, "editado no editor");
            setEditing(false);
          }}
        />
      )}

      {libraryOpen && (
        <TemplateLibrary
          templates={templates}
          activeId={active.id}
          onClose={() => setLibraryOpen(false)}
          onChangeList={setTemplates}
          onUse={(t) => {
            setActive(t);
            setLibraryOpen(false);
          }}
          onCommit={commit}
        />
      )}
    </main>
  );
}
