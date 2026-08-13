import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { 
  Download, Wand2, X, Play, Pause, StopCircle, 
  Columns2, Crop, Copy, Trash2, Layout, Sparkles, 
  Eraser, Radio, History, Database, Settings, Film, Upload,
  Settings2, Scissors
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AppShell, MODES } from "@/components/AppShell";
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
import { getCleanerHealth } from "@/lib/cleaner.functions";

import { 
  createTemplate, 
  defaultCaptions,
  orientationOf,
} from "@/lib/template";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

function Dashboard() {
  const [items, setItems] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"lote" | "clip" | "limpar" | "cleaner">("lote");
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
  const [cleanerStatus, setCleanerStatus] = useState<"online" | "offline" | "checking">("checking");
  
  const current = MODES.find((m) => m.id === mode) || MODES[0];

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
    const timer = setInterval(checkHealth, 30000);
    return () => clearInterval(timer);
  }, []);

  const studioItem = items.find((it) => it.id === studioId);

  // Handlers
  const commit = (t: any, msg?: string) => t;
  const buildSnapshot = () => ({ items: [], templates: [], mode: "lote" });
  const restoreSnapshot = (s: any) => {};

  return (
    <AppShell 
      mode={mode as any} 
      onMode={setMode} 
      count={items.length} 
      counts={{ limpar: items.filter(it => it.mode === 'limpar').length }} 
      onLibrary={() => setLibraryOpen(true)} 
      onCloud={() => setCloudOpen(true)}
    >
      <div className="flex-1 flex flex-col items-center">
        {/* HERO SECTION */}
        <div className="w-full max-w-4xl px-4 py-8">
          <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-surface-2 to-surface p-8 shadow-xl">
             <div className="flex items-start justify-between gap-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider">
                     <Sparkles className="size-4" />
                     {current?.brand} · Ferramenta Independente
                  </div>
                  <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">
                    {current?.headline}
                  </h1>
                  <p className="max-w-xl text-muted-foreground leading-relaxed">
                    {current?.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                     {current?.chips.map(chip => (
                       <span key={chip} className="px-3 py-1 rounded-full bg-background/50 border border-border font-mono text-[10px] text-muted-foreground">{chip}</span>
                     ))}
                  </div>
                </div>
                <div className="grid size-20 place-items-center shrink-0 rounded-2xl bg-primary/10 border border-primary/20 text-primary">
                    {current?.icon && <current.icon className="size-8" />}
                </div>
             </div>
          </div>
        </div>

        {/* WORKFLOW AREA */}
        <div className="w-full max-w-4xl px-4 pb-12">
          {items.length === 0 ? (
            <div className="panel p-12 flex flex-col items-center text-center">
                <div className="mb-6 grid size-16 place-items-center rounded-full bg-primary/10 text-primary">
                    <Upload className="size-8" />
                </div>
                <h3 className="text-xl font-bold mb-2">Importe seu vídeo</h3>
                <p className="text-muted-foreground mb-8 max-w-sm">Cole um link ou arraste arquivos para começar a processar com a inteligência do {current?.brand}.</p>
                
                <div className="w-full max-w-lg flex flex-col gap-4">
                    <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="Cole o link do vídeo (YouTube, Insta, TikTok)..." 
                          className="flex-1 rounded-xl border border-border bg-background px-4 py-3 font-mono text-sm outline-none focus:border-primary transition shadow-sm" 
                        />
                        <Button size="lg" className="px-8 shadow-glow h-[46px]">Importar</Button>
                    </div>
                    <div className="relative group cursor-pointer" onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.multiple = true;
                        input.accept = 'video/*';
                        input.onchange = (e: any) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length > 0) {
                                setItems(p => [...p, ...files.map(f => ({
                                    id: Math.random().toString(36).slice(2),
                                    file: f,
                                    status: 'pendente',
                                    mode: mode === 'cleaner' ? 'limpar' : mode
                                }))]);
                            }
                        };
                        input.click();
                    }}>
                        <div className="rounded-xl border border-dashed border-border/60 bg-surface-2/30 p-4 transition group-hover:border-primary/40 group-hover:bg-primary/5">
                            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground group-hover:text-primary transition">Ou clique para selecionar arquivos</p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-8 border-t border-border w-full flex flex-col items-center gap-4">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/60">
                    tudo roda no navegador - nenhum vídeo sai da sua máquina
                  </p>
                </div>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              {/* Preview e Ajustes */}
              <div className="min-w-0 space-y-6">
                {mode === 'limpar' || mode === 'cleaner' ? (
                  <CleanerIAStudio
                    item={items.find(it => it.id === selectedId) || items[0]}
                    onComplete={() => {}}
                  />
                ) : (
                  <div className="panel p-4 flex flex-col items-center gap-4">
                    <div className="relative aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-xl bg-black shadow-2xl flex items-center justify-center">
                      <TemplateCanvas template={active} previewFile={items.find(it => it.id === selectedId)?.file || items[0].file} />
                    </div>

                    <div className="flex gap-2 w-full max-w-[320px]">
                      {mode === 'lote' && (
                        <Button variant="outline" className="flex-1 rounded-xl h-11" onClick={() => setEditing(true)}>
                          <Settings2 className="size-4 mr-2" /> Layout
                        </Button>
                      )}
                      <Button variant="secondary" className="flex-1 rounded-xl h-11" onClick={() => setStudioId(selectedId)}>
                        <Scissors className="size-4 mr-2" /> Ajustar
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Fila Lateral */}
              <aside className="space-y-4">
                 <div className="panel p-4 space-y-4">
                    <div className="flex items-center justify-between">
                       <h4 className="font-bold text-sm tracking-tight">Fila ({items.length})</h4>
                       <Button variant="ghost" size="icon" className="size-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10" onClick={() => setItems([])}>
                          <Trash2 className="size-4" />
                       </Button>
                    </div>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                       {items.map(it => (
                         <div 
                          key={it.id} 
                          onClick={() => setSelectedId(it.id)} 
                          className={cn(
                            "group p-3 rounded-xl border border-border/60 bg-surface-2 cursor-pointer hover:border-primary/50 transition relative overflow-hidden", 
                            selectedId === it.id && "border-primary bg-primary/5 shadow-[0_0_15px_rgba(34,197,94,0.05)]"
                          )}
                         >
                            <p className="text-xs truncate font-semibold leading-none mb-1">{it.file.name}</p>
                            <p className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">Pendente</p>
                            {selectedId === it.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                         </div>
                       ))}
                    </div>
                    <Button 
                      className="w-full shadow-glow h-11" 
                      disabled={running || items.length === 0}
                      onClick={() => {
                        if (mode === 'cleaner' || mode === 'limpar') {
                          // Se estivermos no modo cleaner, o processamento individual já é lidado pelo CleanerIAStudio
                          // mas o botão "Processar Tudo" pode disparar para todos os itens da fila
                          toast.info("Iniciando processamento em lote para limpeza...");
                          setRunning(true);
                          // Lógica de lote...
                        } else {
                          setRunning(true);
                        }
                      }}
                    >
                       <Sparkles className="size-4 mr-2" />
                       Processar Tudo
                    </Button>
                 </div>
              </aside>
            </div>
          )}
        </div>

        {/* FOOTER STATUS */}
        <div className="w-full max-w-4xl px-4 pb-12">
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
            </div>
            
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => window.location.href = '/biblioteca'}>
                <History className="mr-2 size-3.5" /> Resultados
              </Button>
            </div>
          </div>
        </div>
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
          onUse={(t) => { setActive(t); setLibraryOpen(false); }}
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
