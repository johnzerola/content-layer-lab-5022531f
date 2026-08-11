import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Eraser,
  MousePointer2,
  RefreshCw,
  Shield,
  Sparkles,
  Square,
  Target,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  cleanerHealth,
  createCleanerJob,
  detectCleanerJob,
  processCleanerJob,
  refreshCleanerJob,
} from "@/lib/cleaner.functions";
import {
  MODE_HINT,
  MODE_LABEL,
  PRESET_HINT,
  PRESET_LABEL,
  STAGE_LABEL,
  rid,
  type CleanerJob,
  type CleanerMode,
  type CleanerPreset,
  type CleanerRegion,
} from "@/lib/cleaner";

type Props = {
  item: { id: string; file: File; poster: string | null; w: number; h: number };
  onComplete: (resultUrl: string) => void;
};

type Tool = "select" | "rect" | "protect" | "erase";

const MODES: CleanerMode[] = ["smart", "subtitle", "watermark", "object", "passerby"];
const PRESETS: CleanerPreset[] = ["fast", "quality", "max"];

export function CleanerIAStudio({ item, onComplete }: Props) {
  const [job, setJob] = useState<CleanerJob | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<CleanerMode>("subtitle");
  const [preset, setPreset] = useState<CleanerPreset>("quality");
  const [masks, setMasks] = useState<CleanerRegion[]>([]);
  const [health, setHealth] = useState<{ online: boolean; reason?: string } | null>(null);
  const [polling, setPolling] = useState(false);
  const [tool, setTool] = useState<Tool>("rect");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<CleanerRegion | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const getHealth = useServerFn(cleanerHealth);
  const createJob = useServerFn(createCleanerJob);
  const detectJob = useServerFn(detectCleanerJob);
  const processJob = useServerFn(processCleanerJob);
  const refreshJob = useServerFn(refreshCleanerJob);

  const src = useMemo(() => URL.createObjectURL(item.file), [item.file]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  useEffect(() => {
    getHealth().then((h) => setHealth(h as { online: boolean; reason?: string }));
  }, []);

  useEffect(() => {
    if (!polling || !job?.id) return;
    const timer = window.setInterval(async () => {
      try {
        const status = (await refreshJob({ data: { id: job.id } })) as CleanerJob;
        setJob((prev) => ({ ...(prev as CleanerJob), ...status }));
        if (status.status === "completed") {
          setPolling(false);
          if (status.result_url) onComplete(status.result_url);
          toast.success("Vídeo limpo com sucesso.");
        } else if (status.status === "failed") {
          setPolling(false);
          toast.error(`Falhou: ${status.error || "erro desconhecido"}`);
        }
      } catch {
        /* mantém o polling */
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [polling, job?.id]);

  const visible = masks.filter(
    (m) => (m.from ?? 0) <= time && time <= (m.to ?? (duration || Infinity)),
  );

  const pointAt = useCallback((e: React.PointerEvent) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }, []);

  const onDown = (e: React.PointerEvent) => {
    if (tool === "select" || job?.status === "completed") return;
    const p = pointAt(e);
    if (tool === "erase") {
      const hit = [...visible].reverse().find(
        (m) =>
          p.x >= (m.x ?? 0) && p.x <= (m.x ?? 0) + (m.w ?? 0) &&
          p.y >= (m.y ?? 0) && p.y <= (m.y ?? 0) + (m.h ?? 0),
      );
      if (hit) setMasks((prev) => prev.filter((m) => m.id !== hit.id));
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = p;
    setDraft({
      id: rid(),
      kind: "rect",
      role: tool === "protect" ? "protect" : "remove",
      x: p.x, y: p.y, w: 0, h: 0,
      grow: tool === "protect" ? 0 : 0.008,
      track: true,
      enabled: true,
      label: tool === "protect" ? "Área protegida" : "Área manual",
    });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!dragStart.current || !draft) return;
    const p = pointAt(e);
    const s = dragStart.current;
    setDraft({
      ...draft,
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      w: Math.abs(p.x - s.x),
      h: Math.abs(p.y - s.y),
    });
  };

  const onUp = () => {
    if (draft && (draft.w ?? 0) > 0.01 && (draft.h ?? 0) > 0.01) {
      setMasks((prev) => [...prev, draft]);
      setSelected(draft.id);
    }
    setDraft(null);
    dragStart.current = null;
  };

  const startUpload = async () => {
    if (!health?.online) {
      toast.error("Motor de IA offline — configure o worker GPU.");
      return;
    }
    setUploading(true);
    try {
      const { job: newJob, upload } = (await createJob({
        data: { filename: item.file.name, size: item.file.size, mode, preset },
      })) as { job: CleanerJob; upload?: { url: string; token: string } };
      setJob(newJob);

      if (upload) {
        const formData = new FormData();
        formData.append("file", item.file);
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", upload.url);
          xhr.setRequestHeader("x-job-token", upload.token);
          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(xhr.responseText));
          xhr.onerror = () => reject(new Error("erro de conexão"));
          xhr.send(formData);
        });
      }
      setJob((prev) => (prev ? { ...prev, status: "queued", progress: 0 } : prev));
      toast.success("Vídeo enviado. Detecte as áreas ou marque à mão.");
    } catch (e) {
      toast.error(`Erro no upload: ${e instanceof Error ? e.message : "desconhecido"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDetect = async () => {
    if (!job?.id) return;
    try {
      setJob((prev) => (prev ? { ...prev, status: "detecting", stage: "detectando áreas" } : prev));
      const res = (await detectJob({ data: { id: job.id, mode } })) as CleanerJob;
      const found = (res.detections || []) as CleanerRegion[];
      setMasks((prev) => [...prev, ...found]);
      setJob({ ...res, status: "queued" });
      toast[found.length ? "success" : "warning"](
        found.length ? `${found.length} área(s) encontrada(s).` : "Nada detectado — marque à mão.",
      );
    } catch (e) {
      setJob((prev) => (prev ? { ...prev, status: "queued" } : prev));
      toast.error(`Erro na detecção: ${e instanceof Error ? e.message : "desconhecido"}`);
    }
  };

  const handleProcess = async () => {
    if (!job?.id) return;
    if (!masks.length) {
      toast.error("Marque ao menos uma área ou use Detectar.");
      return;
    }
    try {
      await processJob({ data: { id: job.id, mode, preset, masks, options: {} } });
      setPolling(true);
      setJob((prev) => (prev ? { ...prev, status: "inpainting", progress: 1 } : prev));
      toast.success("Reconstrução iniciada na GPU.");
    } catch (e) {
      toast.error(`Erro ao iniciar: ${e instanceof Error ? e.message : "desconhecido"}`);
    }
  };

  const running = !!job && job.status !== "completed" && job.status !== "queued" && polling;
  const sel = masks.find((m) => m.id === selected) || null;

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr_300px]">
      {/* Modos */}
      <aside className="space-y-2">
        <p className="mono-label px-1">Modo</p>
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => !job && setMode(m)}
            disabled={!!job}
            className={`w-full rounded-xl border p-3 text-left transition ${
              mode === m
                ? "border-primary bg-primary/10 shadow-glow"
                : "border-border/60 bg-surface/40 hover:border-border"
            } disabled:opacity-60`}
          >
            <span className="block text-sm font-display font-bold">{MODE_LABEL[m]}</span>
            <span className="block text-[10px] leading-tight text-muted-foreground">
              {m === "smart" ? "Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required. veja para criar isto de realmente remover, sem cria um borrap, efeito blur, ou quaqluer outra coisa assim" : MODE_HINT[m]}
            </span>
          </button>
        ))}
      </aside>

      {/* Player + máscaras */}
      <div className="space-y-4">
        <div
          ref={stageRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          className={`panel relative aspect-video overflow-hidden rounded-2xl border border-border/60 bg-black ${
            tool === "select" ? "cursor-default" : tool === "erase" ? "cursor-pointer" : "cursor-crosshair"
          }`}
        >
          <video
            ref={videoRef}
            src={job?.status === "completed" && job.result_url ? job.result_url : src}
            controls={job?.status === "completed"}
            playsInline
            className="absolute inset-0 size-full object-contain"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          />

          {job?.status !== "completed" &&
            [...visible, ...(draft ? [draft] : [])].map((m) => (
              <div
                key={m.id}
                onClick={() => tool === "select" && setSelected(m.id)}
                className={`absolute border-2 ${
                  m.role === "protect"
                    ? "border-emerald-400 bg-emerald-400/10"
                    : selected === m.id
                      ? "border-primary bg-primary/25"
                      : "border-primary/70 bg-primary/15"
                }`}
                style={{
                  left: `${(m.x ?? 0) * 100}%`,
                  top: `${(m.y ?? 0) * 100}%`,
                  width: `${(m.w ?? 0) * 100}%`,
                  height: `${(m.h ?? 0) * 100}%`,
                }}
              >
                <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-background/80 px-1 font-mono text-[9px] uppercase">
                  {m.label || m.role}
                </span>
              </div>
            ))}

          {running && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm">
              <RefreshCw className="size-8 animate-spin text-primary" />
              <p className="mt-3 font-display font-bold uppercase tracking-wider">
                {STAGE_LABEL[job!.status] ?? job!.status}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{job!.stage}</p>
              <Progress value={job!.progress} className="mt-4 h-1.5 w-56" />
              <p className="mt-1 font-mono text-[10px]">{Math.round(job!.progress)}%</p>
            </div>
          )}

          {uploading && (
            <div className="absolute inset-x-0 bottom-0 bg-background/80 p-3">
              <p className="mono-label mb-1">enviando {uploadProgress}%</p>
              <Progress value={uploadProgress} className="h-1.5" />
            </div>
          )}
        </div>

        {/* Ferramentas */}
        <div className="flex flex-wrap items-center gap-2">
          {([
            ["rect", "Retângulo", Square],
            ["protect", "Proteger", Shield],
            ["erase", "Apagar", Eraser],
            ["select", "Selecionar", MousePointer2],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                tool === id ? "border-primary bg-primary/15 text-primary" : "border-border/60 bg-surface/40"
              }`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {time.toFixed(2)}s / {duration.toFixed(2)}s
          </span>
        </div>

        {/* Timeline de máscaras */}
        <div className="panel space-y-2 rounded-2xl border border-border/50 bg-surface/30 p-3">
          <p className="mono-label">Timeline das máscaras</p>
          <div className="relative h-14 overflow-hidden rounded-lg bg-background/60">
            {masks.map((m, i) => {
              const from = ((m.from ?? 0) / (duration || 1)) * 100;
              const to = ((m.to ?? duration) / (duration || 1)) * 100;
              return (
                <div
                  key={m.id}
                  onClick={() => setSelected(m.id)}
                  className={`absolute h-4 cursor-pointer rounded ${
                    m.role === "protect" ? "bg-emerald-500/70" : "bg-primary/70"
                  } ${selected === m.id ? "ring-2 ring-primary" : ""}`}
                  style={{ left: `${from}%`, width: `${Math.max(2, to - from)}%`, top: `${(i % 3) * 18 + 2}px` }}
                />
              );
            })}
            <div
              className="absolute inset-y-0 w-px bg-destructive"
              style={{ left: `${(time / (duration || 1)) * 100}%` }}
            />
          </div>
          {sel && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMasks((p) => p.map((m) => (m.id === sel.id ? { ...m, from: time } : m)))}
              >
                Início aqui
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMasks((p) => p.map((m) => (m.id === sel.id ? { ...m, to: time } : m)))}
              >
                Fim aqui
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setMasks((p) =>
                    p.map((m) => {
                      if (m.id !== sel.id) return m;
                      const { from: _f, to: _t, ...rest } = m;
                      return rest as CleanerRegion;
                    }),
                  )
                }
              >
                Vídeo inteiro
              </Button>
              <label className="ml-auto flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={sel.track !== false}
                  onChange={(e) =>
                    setMasks((p) => p.map((m) => (m.id === sel.id ? { ...m, track: e.target.checked } : m)))
                  }
                />
                rastrear (optical flow)
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Configurações */}
      <div className="space-y-5">
        <section className="space-y-4 rounded-2xl border border-border/70 bg-surface/50 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold">Configurações</h3>
            <span
              className={`flex items-center gap-1.5 text-[10px] font-bold uppercase ${
                health?.online ? "text-emerald-500" : "text-destructive"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  health?.online ? "animate-pulse bg-emerald-500" : "bg-destructive"
                }`}
              />
              {health?.online ? "gpu online" : "offline"}
            </span>
          </div>

          <div className="space-y-2">
            <span className="mono-label">Qualidade</span>
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => !job && setPreset(p)}
                disabled={!!job}
                className={`w-full rounded-lg border p-2.5 text-left text-xs transition ${
                  preset === p ? "border-primary bg-primary/10" : "border-border/60 bg-background/40"
                } disabled:opacity-60`}
              >
                <span className="block font-semibold">{PRESET_LABEL[p]}</span>
                <span className="block text-[10px] text-muted-foreground">{PRESET_HINT[p]}</span>
              </button>
            ))}
          </div>

          {!job ? (
            <Button className="w-full shadow-glow" onClick={startUpload} disabled={!health?.online || uploading}>
              <Upload className="mr-2 size-4" /> Enviar para GPU
            </Button>
          ) : job.status === "completed" ? (
            <a
              href={job.result_url ?? "#"}
              download
              className="block w-full rounded-lg bg-primary py-2 text-center text-sm font-semibold text-primary-foreground"
            >
              Baixar vídeo limpo
            </a>
          ) : (
            <div className="space-y-2">
              <Button variant="outline" className="w-full" onClick={handleDetect} disabled={polling}>
                <Target className="mr-2 size-4" /> Detectar
              </Button>
              <Button className="w-full shadow-glow" onClick={handleProcess} disabled={polling}>
                <Sparkles className="mr-2 size-4" /> Remover
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl border border-border/70 bg-surface/50 p-5">
          <h3 className="flex items-center gap-2 font-display font-bold">
            <Target className="size-4 text-primary" /> Áreas ({masks.length})
          </h3>
          {masks.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Arraste sobre o vídeo para marcar o que remover, ou clique em Detectar. O fundo é
              reconstruído com contexto temporal — nunca borrado.
            </p>
          ) : (
            <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
              {masks.map((m) => (
                <div
                  key={m.id}
                  onClick={() => setSelected(m.id)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border p-2 text-xs ${
                    selected === m.id ? "border-primary bg-primary/10" : "border-border/50 bg-background/50"
                  }`}
                >
                  <span className="truncate">{m.label || m.id}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {Math.round((m.w ?? 0) * 100)}×{Math.round((m.h ?? 0) * 100)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMasks((prev) => prev.filter((x) => x.id !== m.id));
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {masks.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full text-[10px] uppercase tracking-widest" onClick={() => setMasks([])}>
              Limpar todas
            </Button>
          )}
        </section>

        {job?.metrics && (
          <section className="rounded-2xl border border-border/70 bg-surface/50 p-4 text-[11px]">
            <p className="mono-label mb-2">Métricas</p>
            <pre className="whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
              {JSON.stringify(job.metrics, null, 1)}
            </pre>
          </section>
        )}

        {health && !health.online && (
          <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="text-[11px] leading-relaxed">
              <p className="font-bold uppercase tracking-tight">Backend offline</p>
              <p className="opacity-80">{health.reason || "worker GPU não configurado"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
