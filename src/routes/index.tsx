import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, X, Play, Download, Pencil, Repeat, Library, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateCanvas } from "@/components/TemplateCanvas";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import { commitTemplate, createTemplate, loadTemplates, type Template } from "@/lib/template";
import { downloadBlob, grabPoster, renderVideo } from "@/lib/render";

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

type Status = "pendente" | "processando" | "pronto" | "erro";

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
  status: Status;
  progress: number;
  blob?: Blob;
  ext?: string;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

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

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const vids = Array.from(files).filter((f) => f.type.startsWith("video/"));
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
      } catch {
        setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "erro" } : p)));
      }
    }
  }, []);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  const processAll = async () => {
    setRunning(true);
    for (const item of items) {
      if (item.status === "pronto") continue;
      setItems((p) => p.map((x) => (x.id === item.id ? { ...x, status: "processando", progress: 0 } : x)));
      try {
        const { blob, ext } = await renderVideo(item.file, active, {
          mirror: active.mirror,
          speed: active.speed,
          offsetX: item.offsetX,
          offsetY: item.offsetY,
          headline: item.headline || undefined,
          onProgress: (p) =>
            setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, progress: p } : x))),
        });
        setItems((p) => p.map((x) => (x.id === item.id ? { ...x, status: "pronto", blob, ext, progress: 1 } : x)));
      } catch {
        setItems((p) => p.map((x) => (x.id === item.id ? { ...x, status: "erro" } : x)));
      }
    }
    setRunning(false);
  };

  const readyCount = items.filter((i) => i.status === "pronto").length;

  const downloadAll = () => {
    items
      .filter((i) => i.blob)
      .forEach((i, idx) =>
        setTimeout(
          () => downloadBlob(i.blob!, `${active.name.replace(/\s+/g, "-").toLowerCase()}-${idx + 1}.${i.ext}`),
          idx * 600,
        ),
      );
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
          </div>
          <div className="flex items-center gap-2">
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
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <Button variant="outline" onClick={() => setActive(createTemplate("Novo template"))}>
              Novo
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
                    <TemplateCanvas template={previewTemplate} interactive={false} poster={selected.poster} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Selecione um vídeo na lista.</p>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button onClick={processAll} disabled={running}>
                  <Play className="size-4" /> {running ? "Processando…" : "Processar em lote"}
                </Button>
                <Button variant="outline" onClick={downloadAll} disabled={readyCount === 0}>
                  <Download className="size-4" /> Baixar todos ({readyCount})
                </Button>
                <span className="font-mono text-xs text-muted-foreground">
                  {active.mirror ? "espelhado · " : ""}velocidade {active.speed.toFixed(2)}x
                </span>
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
