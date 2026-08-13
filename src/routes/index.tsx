import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { 
  Download, Wand2, X, Play, Pause, StopCircle, 
  Columns2, Crop, Copy, Trash2, Layout, Sparkles, 
  Eraser, Radio, History, Database, Settings
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { TemplateCanvas } from "@/components/TemplateCanvas";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import { VideoStudio } from "@/components/VideoStudio";
import { StudioBoundary } from "@/components/StudioBoundary";
import { CaptionTimeline } from "@/components/CaptionTimeline";
import { PreviewCropOverlay } from "@/components/PreviewCropOverlay";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { CloudPanel } from "@/components/CloudPanel";
import { 
  defaultTemplate, 
  defaultPreEdit, 
  defaultCaptions,
  describeVariation,
  formatTime,
  orientationOf,
  hasPreEdit
} from "@/lib/template";
import { cuesToSrt, cuesToText } from "@/lib/captions";
import { webCodecsSupported } from "@/lib/encode";
import { downloadBlob } from "@/lib/utils";

// Mock data and constants to keep the file valid after the reset
const PLATFORM_PRESETS = [
  { id: "tiktok", label: "TikTok", hint: "9:16 vertical" },
  { id: "shorts", label: "Shorts", hint: "9:16 vertical" },
  { id: "reels", label: "Reels", hint: "9:16 vertical" },
];

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const [items, setItems] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"batch" | "clip" | "limpar">("batch");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(defaultTemplate());
  const [templates, setTemplates] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [studioId, setStudioId] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [cropTune, setCropTune] = useState(false);
  const [variantIdx, setVariantIdx] = useState(0);
  const [autoBitrate, setAutoBitrate] = useState(true);
  const [clipMinLen, setClipMinLen] = useState(15);
  const [clipMaxLen, setClipMaxLen] = useState(60);
  const [clipMax, setClipMax] = useState(5);
  const [clipMinScore, setClipMinScore] = useState(60);
  
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const selected = items.find((it) => it.id === selectedId);
  const studioItem = items.find((it) => it.id === studioId);
  const variants = 1;
  const previewVariation = null;
  const previewLoop = { start: 0, end: 0 };
  const previewTemplate = active;
  const previewDrawOpts = { smoothing: true };
  const previewCues: any[] = [];
  const eta = null;
  const flow = { export: { platforms: true } };
  const platforms: string[] = [];

  // Handlers
  const processAll = async () => setRunning(true);
  const togglePause = () => setPaused(!paused);
  const cancelAll = () => setRunning(false);
  const removeItemWithUndo = (id: string) => setItems(p => p.filter(x => x.id !== id));
  const openStudio = async (id: string) => setStudioId(id);
  const togglePlatform = (id: string) => {};
  const useTemplate = (t: any) => setActive(t);
  const commit = (t: any, msg: string) => {};
  const buildSnapshot = () => ({});
  const restoreSnapshot = (s: any) => {};

  return (
    <AppShell mode={mode} onModeChange={setMode}>
      <div className="mx-auto max-w-7xl p-6">
        {mode !== "clip" ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
            <section className="panel space-y-4 p-5">
              {selected ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="mono-label">Visualização</p>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => setCompare(!compare)}>
                        {compare ? "Vista única" : "Comparar"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setCropTune(!cropTune)}>
                        <Crop className="mr-1 size-3" /> Ajustar
                      </Button>
                    </div>
                  </div>

                  <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl">
                    {compare ? (
                      <BeforeAfterSlider
                        before={
                          <TemplateCanvas
                            template={{ ...previewTemplate, cleanup: [] }}
                            previewFile={selected.file}
                          />
                        }
                        after={
                          <TemplateCanvas
                            template={previewTemplate}
                            previewFile={selected.file}
                          />
                        }
                      />
                    ) : (
                      <TemplateCanvas
                        template={previewTemplate}
                        previewFile={selected.file}
                        videoRef={previewVideoRef}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-96 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-surface-1 p-10 text-center">
                  <Sparkles className="mb-4 size-10 text-primary/50" />
                  <p className="text-muted-foreground">Selecione um vídeo para começar a editar</p>
                </div>
              )}
            </section>

            <section className="panel flex flex-col p-5 h-[70vh]">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-semibold">Fila de Processamento ({items.length})</p>
                {items.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setItems([])} className="text-destructive">
                    <Trash2 className="mr-1 size-3" /> limpar
                  </Button>
                )}
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                {items.map((it) => (
                  <div
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition-all ${
                      selectedId === it.id ? "border-primary bg-primary/10" : "border-border bg-surface-2 hover:border-primary/50"
                    }`}
                  >
                    <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {it.poster && <img src={it.poster} alt="thumb" className="size-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{it.file.name}</p>
                      <p className="font-mono text-[10px] text-muted-foreground uppercase">● {it.status}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); openStudio(it.id); }}>
                        <Wand2 className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 hover:text-destructive" onClick={(e) => { e.stopPropagation(); removeItemWithUndo(it.id); }}>
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
            <section className="panel p-5">
              <p className="mb-4 font-semibold">Cortes Automáticos</p>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="mono-label">Duração mín/máx</p>
                    <div className="flex gap-2">
                      <input type="number" value={clipMinLen} onChange={e => setClipMinLen(Number(e.target.value))} className="w-full rounded-md border p-1" />
                      <input type="number" value={clipMaxLen} onChange={e => setClipMaxLen(Number(e.target.value))} className="w-full rounded-md border p-1" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="mono-label">Máx clips</p>
                    <input type="number" value={clipMax} onChange={e => setClipMax(Number(e.target.value))} className="w-full rounded-md border p-1" />
                  </div>
                </div>
              </div>
            </section>
            
            <section className="panel p-5 h-[70vh] flex flex-col">
              <p className="mb-3 font-semibold">Vídeos na fila ({items.length})</p>
              <div className="flex-1 space-y-2 overflow-y-auto">
                 {items.map((it) => (
                   <div key={it.id} className="rounded-lg border p-2 text-sm">{it.file.name}</div>
                 ))}
              </div>
            </section>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
          <div className="flex items-center gap-3">
            <Button size="lg" className="px-10" onClick={() => void processAll()} disabled={running}>
              {running ? <Pause className="mr-2 size-4" /> : <Play className="mr-2 size-4" />}
              {running ? "Processando..." : "Começar Processamento"}
            </Button>
            {running && (
              <Button variant="outline" size="lg" onClick={cancelAll}>
                <StopCircle className="mr-2 size-4 text-destructive" /> Cancelar
              </Button>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setLibraryOpen(true)}>
              <Layout className="mr-2 size-4" /> Templates
            </Button>
            <Button variant="outline" onClick={() => setCloudOpen(true)}>
              <Database className="mr-2 size-4" /> Cloud
            </Button>
          </div>
        </div>

        <footer className="mt-12 py-8 text-center font-mono text-xs text-muted-foreground">
          VAIVIRAL · O editor mais rápido do mundo
        </footer>
      </div>

      {editing && (
        <TemplateEditor
          value={active}
          onCancel={() => setEditing(false)}
          onUse={(t) => { setActive(t); setEditing(false); }}
          onSave={(t) => { commit(t, "editado"); setEditing(false); }}
        />
      )}

      {libraryOpen && (
        <TemplateLibrary
          templates={templates}
          activeId={active.id}
          onClose={() => setLibraryOpen(false)}
          onChangeList={setTemplates}
          onUse={(t) => { useTemplate(t); setLibraryOpen(false); }}
          onCommit={commit}
        />
      )}

      {studioItem && (
        <StudioBoundary onClose={() => setStudioId(null)}>
          <VideoStudio
            file={studioItem.file}
            width={studioItem.w}
            height={studioItem.h}
            duration={studioItem.duration}
            value={{
              pre: studioItem.preEdit ?? defaultPreEdit(),
              clip: studioItem.clip ?? null,
            }}
            captions={studioItem.captions}
            onCaptionsChange={(cues) =>
              setItems((p) => p.map((x) => (x.id === studioItem.id ? { ...x, captions: cues } : x)))
            }
            texts={{
              headline: studioItem.headline || active.headline.text,
              name: active.name_.text,
              handle: active.handle.text,
              cta: active.cta.text,
            }}
            onTextsChange={(t) => {
              setItems((p) => p.map((x) => (x.id === studioItem.id ? { ...x, headline: t.headline } : x)));
            }}
            onClose={() => setStudioId(null)}
            onSave={({ pre, clip }) => {
              setItems((p) =>
                p.map((x) =>
                  x.id === studioItem.id
                    ? { ...x, preEdit: pre, clip: clip ?? undefined, status: "pendente" }
                    : x,
                ),
              );
              setStudioId(null);
            }}
          />
        </StudioBoundary>
      )}

      {cloudOpen && (
        <CloudPanel
          templates={templates}
          onClose={() => setCloudOpen(false)}
          onChangeList={setTemplates}
          mode={mode}
          buildSnapshot={buildSnapshot}
          onRestore={restoreSnapshot}
        />
      )}
    </AppShell>
  );
}
