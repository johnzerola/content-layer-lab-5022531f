import { useEffect, useState } from "react";
import { 
  Eraser, 
  Sparkles, 
  Settings2, 
  Play, 
  Upload, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  RefreshCw,
  Target,
  MousePointer2,
  Trash2,
  PlusCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { 
  createCleanerJob, 
  detectCleanerJob, 
  processCleanerJob, 
  refreshCleanerJob,
  cleanerHealth 
} from "@/lib/cleaner.functions";
import type { CleanerJob, CleanerRegion, CleanerStatus } from "@/lib/cleaner";

type Props = {
  item: {
    id: string;
    file: File;
    poster: string | null;
    w: number;
    h: number;
  };
  onComplete: (resultUrl: string) => void;
};

export function CleanerIAStudio({ item, onComplete }: Props) {
  const [job, setJob] = useState<CleanerJob | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [mode, setMode] = useState<"subtitle" | "watermark" | "object">("subtitle");
  const [preset, setPreset] = useState<"fast" | "quality" | "max">("quality");
  const [masks, setMasks] = useState<CleanerRegion[]>([]);
  const [health, setHealth] = useState<{ online: boolean; reason?: string } | null>(null);
  const [polling, setPolling] = useState(false);

  const getHealth = useServerFn(cleanerHealth);
  const createJob = useServerFn(createCleanerJob);
  const detectJob = useServerFn(detectCleanerJob);
  const processJob = useServerFn(processCleanerJob);
  const refreshJob = useServerFn(refreshCleanerJob);

  useEffect(() => {
    getHealth().then(setHealth);
  }, []);

  // Polling for job status
  useEffect(() => {
    let timer: number;
    if (polling && job?.id) {
      timer = window.setInterval(async () => {
        try {
          const status = await refreshJob({ data: { id: job.id } });
          setJob(prev => ({ ...prev, ...status }));
          if (status.status === "completed") {
            setPolling(false);
            if (status.result_url) onComplete(status.result_url);
            toast.success("Vídeo limpo com sucesso!");
          } else if (status.status === "failed") {
            setPolling(false);
            toast.error("Erro no processamento: " + (status.error || "Desconhecido"));
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      }, 3000);
    }
    return () => clearInterval(timer);
  }, [polling, job?.id]);

  const startUpload = async () => {
    if (!health?.online) {
      toast.error("Motor de IA Offline: Verifique a conexão com o worker GPU.");
      return;
    }

    try {
      const { job: newJob, upload } = await createJob({ 
        data: { 
          filename: item.file.name, 
          size: item.file.size,
          mode,
          preset
        } 
      });
      
      setJob(newJob as any);

      if (upload) {
        // Direct upload to worker using the token from server
        const formData = new FormData();
        formData.append("file", item.file);

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", upload.url);
          xhr.setRequestHeader("x-job-token", upload.token);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(true);
            else reject(new Error(xhr.responseText));
          };
          xhr.onerror = () => reject(new Error("Erro de conexão"));
          xhr.send(formData);
        });
        
        setJob(prev => prev ? ({ ...prev, status: "queued", progress: 0 }) : null);
        toast.success("Upload concluído! Pronto para detecção.");
      }
    } catch (e) {
      toast.error("Erro no upload: " + (e instanceof Error ? e.message : "Desconhecido"));
    }
  };

  const handleDetect = async () => {
    if (!job?.id) return;
    try {
      setJob(prev => prev ? ({ ...prev, status: "detecting", stage: "detectando áreas..." }) : null);
      const res = await detectJob({ data: { id: job.id, mode } });
      setMasks(res.detections as any);
      setJob(res as any);
      toast.info(`${res.detections.length} áreas encontradas.`);
    } catch (e) {
      toast.error("Erro na detecção: " + (e instanceof Error ? e.message : "Desconhecido"));
    }
  };

  const handleProcess = async () => {
    if (!job?.id) return;
    try {
      await processJob({
        data: {
          id: job.id,
          mode,
          preset,
          masks: masks as any,
          options: {}
        }
      });
      setPolling(true);
      toast.success("Processamento iniciado na GPU.");
    } catch (e) {
      toast.error("Erro ao iniciar: " + (e instanceof Error ? e.message : "Desconhecido"));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {/* Main Preview Area */}
        <div className="panel relative aspect-video overflow-hidden rounded-2xl border-2 border-dashed border-border/50 bg-surface-2">
          {item.poster ? (
            <img src={item.poster} className="absolute inset-0 size-full object-contain opacity-50" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <Upload className="size-12 opacity-20" />
            </div>
          )}
          
          {/* Overlay Masks */}
          {masks.map(m => (
            <div 
              key={m.id}
              className="absolute border-2 border-primary bg-primary/20"
              style={{
                left: `${(m.x || 0) * 100}%`,
                top: `${(m.y || 0) * 100}%`,
                width: `${(m.w || 0) * 100}%`,
                height: `${(m.h || 0) * 100}%`
              }}
            />
          ))}

          {job?.status === "completed" && job.result_url && (
            <video src={job.result_url} controls className="absolute inset-0 size-full object-contain bg-black" />
          )}

          {job?.status && job.status !== "completed" && job.status !== "queued" && job.status !== "uploading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-sm">
              <RefreshCw className="size-8 animate-spin text-primary" />
              <p className="mt-4 font-display font-bold uppercase tracking-wider">{job.status}</p>
              <p className="mt-1 text-sm text-muted-foreground">{Math.round(job.progress)}%</p>
              <Progress value={job.progress} className="mt-4 w-48 h-1.5" />
            </div>
          )}
        </div>

        {/* Timeline placeholder */}
        <div className="panel h-24 flex items-center justify-center border-border/40 bg-surface/30">
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">Timeline de Keyframes</p>
        </div>
      </div>

      {/* Sidebar Controls */}
      <div className="space-y-5">
        <section className="space-y-4 rounded-2xl border border-border/70 bg-surface/50 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold">Configurações</h3>
            {health?.online ? (
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-green-500 uppercase">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" /> online
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-destructive uppercase">
                <span className="size-1.5 rounded-full bg-destructive" /> offline
              </span>
            )}
          </div>

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="mono-label">Modo</span>
              <select 
                value={mode}
                onChange={(e) => setMode(e.target.value as any)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20"
                disabled={!!job}
              >
                <option value="subtitle">Subtitle (Legenda)</option>
                <option value="watermark">Watermark (Marca d'água)</option>
                <option value="object">Object (Objeto/Pessoa)</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="mono-label">Qualidade</span>
              <select 
                value={preset}
                onChange={(e) => setPreset(e.target.value as any)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20"
                disabled={!!job}
              >
                <option value="fast">Rápido (STTN)</option>
                <option value="quality">Qualidade (ProPainter)</option>
                <option value="max">Ultra (Double-pass)</option>
              </select>
            </label>
          </div>

          {!job && (
            <Button className="w-full shadow-glow" onClick={startUpload} disabled={!health?.online}>
              <Upload className="mr-2 size-4" /> Enviar para GPU
            </Button>
          )}

          {job?.status === "queued" && (
            <div className="space-y-2 pt-2">
              <Button variant="outline" className="w-full" onClick={handleDetect}>
                <Target className="mr-2 size-4" /> Detectar áreas
              </Button>
              <Button className="w-full shadow-glow" onClick={handleProcess}>
                <Sparkles className="mr-2 size-4" /> Remover Agora
              </Button>
            </div>
          )}
        </section>

        {masks.length > 0 && (
          <section className="space-y-3 rounded-2xl border border-border/70 bg-surface/50 p-5">
            <h3 className="flex items-center gap-2 font-display font-bold">
              <Target className="size-4 text-primary" /> Áreas ({masks.length})
            </h3>
            <div className="max-h-[200px] space-y-2 overflow-y-auto pr-1">
              {masks.map(m => (
                <div key={m.id} className="group flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-2 text-xs">
                  <span className="font-mono text-muted-foreground">{m.id}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{Math.round((m.w || 0)*100)}%</span>
                    <button 
                      onClick={() => setMasks(prev => prev.filter(x => x.id !== m.id))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="w-full text-[10px] uppercase tracking-widest" onClick={() => setMasks([])}>
              Limpar todas
            </Button>
          </section>
        )}

        {health?.reason && !health.online && (
          <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="text-[11px] leading-relaxed">
              <p className="font-bold uppercase tracking-tight">Backend Offline</p>
              <p className="opacity-80">{health.reason}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
