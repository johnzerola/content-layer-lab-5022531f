import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { 
  Download, Wand2, X, Play, Pause, StopCircle, 
  Columns2, Crop, Copy, Trash2, Layout, Sparkles, 
  Eraser, Radio, History, Database, Settings, Film
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
import { CleanerIAStudio } from "@/components/CleanerIAStudio";
import { 
  createTemplate, 
  defaultCaptions,
  orientationOf,
} from "@/lib/template";
import { cn } from "@/lib/utils";

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
  const [mode, setMode] = useState<"lote" | "clip" | "limpar">("lote");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [active, setActive] = useState(createTemplate());
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
  const [cleanerStatus, setCleanerStatus] = useState<"online" | "offline" | "checking">("checking");

  
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await getCleanerHealth();
        setCleanerStatus(res.status === "online" ? "online" : "offline");
      } catch {
        setCleanerStatus("offline");
      }
    }
    checkHealth();
    const timer = setInterval(checkHealth, 30000); // Check every 30s
    return () => clearInterval(timer);
  }, []);


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
  const commit = (t: any, msg?: string) => t;
  const buildSnapshot = () => ({ items: [], templates: [], mode: "lote" });
  const restoreSnapshot = (s: any) => {};

  return (
    <AppShell mode={mode} onMode={setMode} count={items.length} counts={{ limpar: items.filter(it => it.mode === 'limpar').length }} onLibrary={() => setLibraryOpen(true)} onCloud={() => setCloudOpen(true)}>
      <div className="flex flex-col gap-6">
        {/* ÁREA PRINCIPAL: Visualização + Fila */}
        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          {/* COLUNA ESQUERDA: Visualização / Ajuste */}
          <section className="panel flex flex-col p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="mono-label">Passo 1 & 2</p>
                <h3 className="text-lg font-bold">Visualização e Ajustes</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {selected && mode === "lote" && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setCompare(!compare)} className="h-8">
                      {compare ? "Vista única" : "Comparar"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setCropTune(!cropTune)} className="h-8">
                      <Crop className="mr-1.5 size-3.5" /> Enquadrar
                    </Button>
                  </>
                )}
                {mode === "clip" && (
                   <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(true)}>
                     <Settings className="mr-1.5 size-3.5" /> Configurar
                   </Button>
                )}
              </div>
            </div>

            <div className="relative flex-1 min-h-[400px] flex flex-col justify-center rounded-2xl bg-black/40 shadow-inner ring-1 ring-border/50">
              {mode === "lote" && (
                selected ? (
                  <div className="relative h-full w-full p-4 flex items-center justify-center">
                    <div className="relative aspect-[9/16] h-full max-h-[600px] overflow-hidden rounded-xl bg-black shadow-2xl">
                      {compare ? (
                        <BeforeAfterSlider
                          before={<TemplateCanvas template={{ ...previewTemplate, cleanup: [] }} previewFile={selected.file} />}
                          after={<TemplateCanvas template={previewTemplate} previewFile={selected.file} />}
                        />
                      ) : (
                        <TemplateCanvas template={previewTemplate} previewFile={selected.file} videoRef={previewVideoRef} />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="mb-6 grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
                      <Sparkles className="size-8" />
                    </div>
                    <p className="text-lg font-medium">Nenhum vídeo selecionado</p>
                    <p className="mt-1 text-sm text-muted-foreground">Importe e selecione um vídeo da fila para começar</p>
                  </div>
                )
              )}

              {mode === "clip" && (
                <div className="p-8 space-y-6">
                   <div className="grid gap-6 sm:grid-cols-2">
                     <div className="space-y-3">
                       <p className="mono-label">Configurações de Corte</p>
                       <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
                         <div className="space-y-2">
                           <div className="flex justify-between text-xs">
                             <span className="text-muted-foreground">Duração mínima (seg)</span>
                             <span className="font-mono">{clipMinLen}s</span>
                           </div>
                           <input type="range" min={5} max={30} step={1} value={clipMinLen} onChange={e => setClipMinLen(Number(e.target.value))} className="w-full accent-primary" />
                         </div>
                         <div className="space-y-2">
                           <div className="flex justify-between text-xs">
                             <span className="text-muted-foreground">Duração máxima (seg)</span>
                             <span className="font-mono">{clipMaxLen}s</span>
                           </div>
                           <input type="range" min={15} max={180} step={5} value={clipMaxLen} onChange={e => setClipMaxLen(Number(e.target.value))} className="w-full accent-primary" />
                         </div>
                       </div>
                     </div>
                     <div className="space-y-3">
                        <p className="mono-label">Resultados esperados</p>
                        <div className="space-y-4 rounded-xl border border-border bg-surface-2 p-4">
                          <div className="space-y-2">
                             <div className="flex justify-between text-xs">
                               <span className="text-muted-foreground">Máximo de clipes</span>
                               <span className="font-mono">{clipMax}</span>
                             </div>
                             <input type="range" min={1} max={20} step={1} value={clipMax} onChange={e => setClipMax(Number(e.target.value))} className="w-full accent-primary" />
                          </div>
                          <div className="space-y-2">
                             <div className="flex justify-between text-xs">
                               <span className="text-muted-foreground">Score viral mínimo</span>
                               <span className="font-mono">{clipMinScore}%</span>
                             </div>
                             <input type="range" min={0} max={100} step={5} value={clipMinScore} onChange={e => setClipMinScore(Number(e.target.value))} className="w-full accent-primary" />
                          </div>
                        </div>
                     </div>
                   </div>
                </div>
              )}

              {mode === "limpar" && (
                selected ? (
                  <CleanerIAStudio 
                    item={selected} 
                    onComplete={(url: string) => {
                      setItems(p => p.map(x => x.id === selected.id ? { ...x, status: 'pronto', result: url } : x));
                    }} 
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="mb-6 grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
                      <Eraser className="size-8" />
                    </div>
                    <p className="text-lg font-medium">Selecione para limpar</p>
                    <p className="mt-1 text-sm text-muted-foreground">Importe um vídeo para remover legendas ou marcas d'água</p>
                  </div>
                )
              )}
            </div>
          </section>

          {/* COLUNA DIREITA: Fila / Importar */}
          <section className="panel flex flex-col p-5 lg:h-[calc(100vh-280px)] lg:min-h-[500px]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="mono-label">Importar</p>
                <h3 className="text-lg font-bold">Fila ({items.length})</h3>
              </div>
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setCloudOpen(true)} className="h-8">
                  <Database className="mr-1.5 size-3.5" /> Nuvem
                </Button>
                {items.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setItems([])} className="h-8 text-destructive hover:bg-destructive/10">
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
              {items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-border/50 bg-surface-1/50 p-6 text-center">
                  <p className="text-sm text-muted-foreground">Sua fila está vazia.<br/>Importe vídeos via Cloud ou Arraste arquivos aqui.</p>
                </div>
              ) : (
                items.map((it) => (
                  <div
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    className={`group flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                      selectedId === it.id 
                        ? "border-primary bg-primary/10 shadow-[0_0_15px_rgba(34,197,94,0.1)]" 
                        : "border-border bg-surface-2 hover:border-primary/50 hover:bg-surface-3"
                    }`}
                  >
                    <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted shadow-sm">
                      {it.poster ? (
                        <img src={it.poster} alt="thumb" className="size-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-muted/50">
                          <Film className="size-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="size-5 text-white fill-white" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-semibold leading-none">{it.file.name}</p>
                      <div className="flex items-center gap-2">
                        <span className={`size-1.5 rounded-full ${it.status === 'pronto' ? 'bg-primary' : it.status === 'erro' ? 'bg-destructive' : 'bg-warn animate-pulse'}`} />
                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{it.status}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="size-8" onClick={(e) => { e.stopPropagation(); openStudio(it.id); }}>
                        <Wand2 className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); removeItemWithUndo(it.id); }}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* BOTÃO DE PROCESSAMENTO INTEGRADO NA FILA */}
            <div className="mt-4 pt-4 border-t border-border">
              <Button 
                size="lg" 
                className="w-full shadow-lg shadow-primary/20" 
                onClick={() => void processAll()} 
                disabled={running || items.length === 0}
              >
                {running ? (
                  <div className="flex items-center gap-3">
                    <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                    <span>Processando…</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-5" />
                    <span>Processar Lote</span>
                  </div>
                )}
              </Button>
              {running && (
                <Button variant="ghost" className="mt-2 w-full text-xs text-destructive hover:bg-destructive/5" onClick={cancelAll}>
                  <StopCircle className="mr-2 size-3" /> Cancelar processamento
                </Button>
              )}
            </div>
          </section>
        </div>

        {/* RODAPÉ: Ações Globais / Info */}
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-border bg-surface/40 p-6 backdrop-blur-sm">
          <div className="flex items-center gap-8">
            <div className="space-y-1">
              <p className="mono-label text-muted-foreground">CleanerIA Status</p>
              <div className="flex items-center gap-2">
                <div className={`size-2 rounded-full ${
                  cleanerStatus === "online" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : 
                  cleanerStatus === "offline" ? "bg-destructive" : "bg-muted-foreground animate-pulse"
                }`} />
                <span className="text-xs font-mono uppercase tracking-wider">
                  {cleanerStatus === "online" ? "Motor Online" : cleanerStatus === "offline" ? "Motor Offline" : "Verificando..."}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="mono-label text-muted-foreground">Template Ativo</p>

              <div className="flex items-center gap-2">
                <Layout className="size-4 text-primary" />
                <span className="text-sm font-semibold">{active.name}</span>
                <Button variant="link" size="sm" onClick={() => setLibraryOpen(true)} className="h-auto p-0 text-xs">
                  Alterar
                </Button>
              </div>
            </div>
            {items.length > 0 && (
              <div className="space-y-1">
                <p className="mono-label text-muted-foreground">Estimativa</p>
                <p className="text-sm font-semibold">~{Math.ceil(items.length * 0.8)} min total</p>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <Button variant="outline" size="lg" className="h-12 px-6" onClick={() => setLibraryOpen(true)}>
              <Columns2 className="mr-2 size-4" /> Estúdio de Templates
            </Button>
            <Button variant="outline" size="lg" className="h-12 px-6" onClick={() => window.location.href = '/biblioteca'}>
              <History className="mr-2 size-4" /> Histórico de Resultados
            </Button>
          </div>
        </div>

        <footer className="py-12 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/50">
          VAIVIRAL · Professional Content Engine · {new Date().getFullYear()}
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
              pre: studioItem.preEdit ?? { trim: { start: 0, end: studioItem.duration }, crop: { x: 0, y: 0, w: 1, h: 1 }, speed: 1, mirror: false },
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
