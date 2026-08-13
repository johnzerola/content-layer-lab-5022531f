import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Eraser,
  MousePointer2,
  PenTool,
  Pentagon,
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
  cleanupCleanerRemoteJob,
  confirmCleanerUpload,
  createCleanerJob,
  detectCleanerJob,
  prepareCleanerUpload,
  processCleanerJob,
  refreshCleanerJob,
  saveCleanerMasks,
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
import { cloudAuthHeaders } from "@/lib/cloud";

type Props = {
  item: { id: string; file: File; poster: string | null; w: number; h: number };
  onComplete: (resultUrl: string) => void;
};

type Tool = "select" | "rect" | "poly" | "brush" | "protect" | "erase";

const MODES: CleanerMode[] = ["smart", "text", "watermark", "object", "passerby"];
const PRESETS: CleanerPreset[] = ["fast", "quality", "max"];

export function CleanerIAStudio({ item, onComplete }: Props) {
  const [job, setJob] = useState<CleanerJob | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [inputReady, setInputReady] = useState(false);
  const [mode, setMode] = useState<CleanerMode>("smart");
  const [preset, setPreset] = useState<CleanerPreset>("quality");
  const [dynamicMask, setDynamicMask] = useState(true);
  const [protectSubject, setProtectSubject] = useState(true);
  const [verifyPass, setVerifyPass] = useState(true);
  const [cropClean, setCropClean] = useState(true);
  const [enhanceOutput, setEnhanceOutput] = useState(true);
  const [masks, setMasks] = useState<CleanerRegion[]>([]);
  const [health, setHealth] = useState<{
    online: boolean;
    ai_ready?: boolean;
    max_ready?: boolean;
    cuda?: boolean;
    gpu?: string;
    reason?: string;
  } | null>(null);
  const [polling, setPolling] = useState(false);
  const [tool, setTool] = useState<Tool>("rect");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<CleanerRegion | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [brushSize, setBrushSize] = useState(0.015);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const polyPoints = useRef<{ x: number; y: number }[]>([]);

  const getHealth = useServerFn(cleanerHealth);
  const confirmUpload = useServerFn(confirmCleanerUpload);
  const createJob = useServerFn(createCleanerJob);
  const detectJob = useServerFn(detectCleanerJob);
  const prepareUpload = useServerFn(prepareCleanerUpload);
  const processJob = useServerFn(processCleanerJob);
  const refreshJob = useServerFn(refreshCleanerJob);
  const saveMasks = useServerFn(saveCleanerMasks);
  const cleanupRemoteJob = useServerFn(cleanupCleanerRemoteJob);

  const src = useMemo(() => URL.createObjectURL(item.file), [item.file]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  useEffect(() => {
    let alive = true;
    const check = () =>
      getHealth()
        .then(
          (h) =>
            alive &&
            setHealth(
              h as {
                online: boolean;
                ai_ready?: boolean;
                max_ready?: boolean;
                cuda?: boolean;
                gpu?: string;
                reason?: string;
              },
            ),
        )
        .catch(
          (e) =>
            alive &&
            setHealth({ online: false, reason: e instanceof Error ? e.message : "sem resposta" }),
        );
    check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [getHealth]);

  useEffect(() => {
    if (job || !health?.online) return;
    if (health.ai_ready === false && preset !== "fast") setPreset("fast");
    else if (preset === "max" && health.max_ready === false) setPreset("quality");
  }, [health, job, preset]);

  useEffect(() => {
    if (!polling || !job?.id) return;
    const timer = window.setInterval(async () => {
      try {
        const headers = await cloudAuthHeaders();
        const status = (await refreshJob({ data: { id: job.id }, headers })) as CleanerJob;
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
  }, [polling, job?.id, onComplete, refreshJob]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && tool === "poly") finishPolygon();
      if (e.key === "Escape" && tool === "poly") cancelPolygon();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  const visible = masks.filter(
    (m) => (m.from ?? 0) <= time + 0.1 && time <= (m.to ?? (duration || Infinity)) + 0.1,
  );

  const pointAt = useCallback((e: React.PointerEvent) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }, []);

  const hitTest = (p: { x: number; y: number }, m: CleanerRegion) => {
    if (m.kind === "rect") {
      return (
        p.x >= (m.x ?? 0) &&
        p.x <= (m.x ?? 0) + (m.w ?? 0) &&
        p.y >= (m.y ?? 0) &&
        p.y <= (m.y ?? 0) + (m.h ?? 0)
      );
    }
    if (m.kind === "poly" && m.points && m.points.length > 2) {
      // teste de ponto em polígono via ray-casting simples
      let inside = false;
      const pts = m.points;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const pi = pts[i];
        const pj = pts[j];
        if (!pi || !pj) continue;
        const xi = pi.x,
          yi = pi.y;
        const xj = pj.x,
          yj = pj.y;
        const intersect = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    }
    if (m.kind === "brush" && m.points) {
      return m.points.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < (m.size ?? 0.01));
    }
    return false;
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool === "select" || job?.status === "completed") return;
    const p = pointAt(e);
    if (tool === "erase") {
      const hit = [...visible].reverse().find((m) => hitTest(p, m));
      if (hit) setMasks((prev) => prev.filter((m) => m.id !== hit.id));
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = p;

    if (tool === "poly") {
      polyPoints.current = [...polyPoints.current, p];
      setDraft({
        id: rid(),
        kind: "poly",
        role: "remove",
        points: polyPoints.current,
        grow: 0.004,
        track: true,
        enabled: true,
        label: "Polígono",
      });
      return;
    }

    if (tool === "brush") {
      setDraft({
        id: rid(),
        kind: "brush",
        role: "remove",
        points: [p],
        size: brushSize,
        grow: 0,
        track: true,
        enabled: true,
        label: "Pincel",
      });
      return;
    }

    setDraft({
      id: rid(),
      kind: "rect",
      role: tool === "protect" ? "protect" : "remove",
      x: p.x,
      y: p.y,
      w: 0,
      h: 0,
      grow: tool === "protect" ? 0 : 0.008,
      track: true,
      enabled: true,
      label: tool === "protect" ? "Área protegida" : "Área manual",
    });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = pointAt(e);
    if (tool === "brush" && draft?.kind === "brush") {
      setDraft({
        ...draft,
        points: [...(draft.points ?? []), p],
      });
      return;
    }
    if (!dragStart.current || !draft || draft.kind !== "rect") return;
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
    if (draft?.kind === "poly") {
      // polígono só é finalizado com duplo-clique ou tecla Enter
      return;
    }
    if (draft?.kind === "brush" && (draft.points?.length ?? 0) > 1) {
      setMasks((prev) => [...prev, draft]);
      setSelected(draft.id);
    }
    if (draft?.kind === "rect" && (draft.w ?? 0) > 0.01 && (draft.h ?? 0) > 0.01) {
      setMasks((prev) => [...prev, draft]);
      setSelected(draft.id);
    }
    setDraft(null);
    dragStart.current = null;
  };

  const finishPolygon = () => {
    if (polyPoints.current.length > 2) {
      const region: CleanerRegion = {
        id: rid(),
        kind: "poly",
        role: "remove",
        points: polyPoints.current,
        grow: 0.004,
        track: true,
        enabled: true,
        label: "Polígono",
      };
      setMasks((prev) => [...prev, region]);
      setSelected(region.id);
    }
    polyPoints.current = [];
    setDraft(null);
  };

  const cancelPolygon = () => {
    polyPoints.current = [];
    setDraft(null);
  };

  const startUpload = async () => {
    if (!health?.online) {
      toast.error("Motor de IA offline — configure o processamento local.");
      return;
    }
    setUploading(true);
    setInputReady(false);
    try {
      const headers = await cloudAuthHeaders();
      let newJob: CleanerJob;
      let upload: { url: string; token: string } | undefined;
      if (job?.id && !inputReady) {
        newJob = job;
        ({ upload } = (await prepareUpload({ data: { id: job.id }, headers })) as {
          upload: { url: string; token: string };
        });
      } else {
        ({ job: newJob, upload } = (await createJob({
          data: { filename: item.file.name, size: item.file.size, mode, preset },
          headers,
        })) as { job: CleanerJob; upload?: { url: string; token: string } });
      }
      setJob(newJob);

      if (upload) {
        const verifyUpload = async () =>
          (await confirmUpload({ data: { id: newJob.id }, headers })) as CleanerJob;

        const send = (url: string) =>
          new Promise<void>((resolve, reject) => {
            const formData = new FormData();
            formData.append("file", item.file);
            const isProxy = url.includes("/api/public/cleaner-upload");
            const xhr = new XMLHttpRequest();
            let settled = false;
            let lastProgressAt = Date.now();
            let lastProgress = 0;
            const finish = (fn: () => void) => {
              if (settled) return;
              settled = true;
              window.clearInterval(stallTimer);
              fn();
            };
            const stallTimer = window.setInterval(async () => {
              if (settled || Date.now() - lastProgressAt < 25_000) return;
              try {
                const remote = await verifyUpload();
                if (remote?.id) {
                  xhr.abort();
                  finish(resolve);
                  return;
                }
              } catch {
                // Continua tentando ate o timeout do XHR.
              }
              if (lastProgress > 0) {
                xhr.abort();
                finish(() => reject(new Error("envio sem resposta; tentando rota alternativa")));
              }
            }, 5_000);
            xhr.open("POST", url);
            xhr.timeout = 2 * 60 * 1000;
            xhr.setRequestHeader("x-job-token", upload.token);
            xhr.setRequestHeader("x-file-size", String(item.file.size));
            if (isProxy) {
              xhr.setRequestHeader("x-file-name", encodeURIComponent(item.file.name).slice(0, 500));
            }
            xhr.upload.onprogress = (ev) => {
              if (!ev.lengthComputable) return;
              const nextProgress = Math.round((ev.loaded / ev.total) * 100);
              if (nextProgress === lastProgress) return;
              lastProgress = nextProgress;
              lastProgressAt = Date.now();
              setUploadProgress(nextProgress);
            };
            xhr.onload = () =>
              finish(() =>
                xhr.status >= 200 && xhr.status < 300
                  ? resolve()
                  : reject(new Error(`${xhr.status} ${xhr.responseText || "falha no envio"}`)),
              );
            xhr.onerror = () => finish(() => reject(new Error("rede-bloqueada")));
            xhr.ontimeout = () => finish(() => reject(new Error("tempo esgotado no envio")));
            xhr.onabort = () => {
              if (!settled) finish(() => reject(new Error("envio interrompido")));
            };
            xhr.send(isProxy ? item.file : formData);
          });

        // rota alternativa pela própria origem, para redes que bloqueiam o domínio do motor
        const proxyUrl = `/api/public/cleaner-upload?job=${encodeURIComponent(newJob.id)}`;

        let confirmed: CleanerJob | null = null;

        try {
          await send(upload.url);
        } catch (first) {
          try {
            confirmed = await verifyUpload();
          } catch {
            setUploadProgress(0);
            await new Promise((r) => setTimeout(r, 1000));
            try {
              await send(proxyUrl);
            } catch (second) {
              try {
                confirmed = await verifyUpload();
              } catch {
                throw new Error(
                  `${first instanceof Error ? first.message : "falha"}; fallback: ${
                    second instanceof Error ? second.message : "erro"
                  }`,
                );
              }
            }
          }
        }
        confirmed ??= await verifyUpload();
        setJob(confirmed);
        setInputReady(true);
      }
      toast.success("Vídeo enviado. Detecte as áreas ou marque à mão.");
    } catch (e) {
      toast.error(`Erro no upload: ${e instanceof Error ? e.message : "desconhecido"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDetect = async () => {
    if (!inputReady) {
      toast.error("O vídeo ainda não foi confirmado no motor. Reenvie o arquivo.");
      return;
    }
    // Primeiro salva as máscaras atuais para garantir persistência antes da detecção
    if (masks.length > 0 && job?.id) {
      const headers = await cloudAuthHeaders();
      await saveMasks({ data: { id: job.id, masks }, headers }).catch(() => null);
    }

    if (!job?.id) return;
    try {
      setJob((prev) => (prev ? { ...prev, status: "detecting", stage: "detectando áreas" } : prev));
      const headers = await cloudAuthHeaders();
      const res = (await detectJob({ data: { id: job.id, mode }, headers })) as CleanerJob;
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
    if (!inputReady) {
      toast.error("O vídeo ainda não foi confirmado no motor. Reenvie o arquivo.");
      return;
    }
    if (!masks.length && !cropClean) {
      toast.error("Marque ao menos uma área ou use Detectar.");
      return;
    }
    try {
      const headers = await cloudAuthHeaders();
      await processJob({
        data: {
          id: job.id,
          mode,
          preset,
          masks,
          options: {
            dynamic: dynamicMask,
            protect_subject: protectSubject,
            verify: verifyPass,
            strategy: cropClean ? "crop-clean" : "inpaint",
            crop_clean: { y: 0.26, h: 0.435 },
            enhance: enhanceOutput ? { mode: "hq", scale: 1 } : { mode: "off" },
            crf: enhanceOutput ? 14 : 16,
            key_step: dynamicMask ? 3 : 8,
          },
        },
        headers,
      });
      setPolling(true);
      setJob((prev) => (prev ? { ...prev, status: "inpainting", progress: 1 } : prev));
      toast.success("Reconstrução iniciada no motor de IA.");
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
        <p className="mono-label px-1">Ferramentas de IA</p>
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
              {MODE_HINT[m]}
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
          onDoubleClick={() => tool === "poly" && finishPolygon()}
          className={`panel relative aspect-video overflow-hidden rounded-2xl border border-border/60 bg-black touch-none z-0 ${
            tool === "select"
              ? "cursor-default"
              : tool === "erase"
                ? "cursor-pointer"
                : "cursor-crosshair"
          }`}
        >
          <video
            ref={videoRef}
            src={job?.status === "completed" && job.result_url ? job.result_url : src}
            controls={job?.status === "completed"}
            playsInline
            className="absolute inset-0 size-full object-contain z-0"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          />

          {job?.status !== "completed" &&
            [...visible, ...(draft ? [draft] : [])].map((m) => {
              const baseClasses =
                m.role === "protect"
                  ? "border-emerald-400 bg-emerald-400/10"
                  : selected === m.id
                    ? "border-primary bg-primary/30 ring-2 ring-primary ring-offset-1 ring-offset-black z-20"
                    : "border-primary/80 bg-primary/20 hover:bg-primary/30 z-10";

              if (m.kind === "poly" && m.points) {
                const pts = m.points.map((pt) => `${pt.x * 100}% ${pt.y * 100}%`).join(",");
                return (
                  <div
                    key={m.id}
                    onClick={() => tool === "select" && setSelected(m.id)}
                    className={`absolute inset-0 ${tool === "select" ? "pointer-events-auto" : "pointer-events-none"}`}
                  >
                    <svg className="absolute inset-0 size-full" preserveAspectRatio="none">
                      <polygon
                        points={pts}
                        className={`fill-current ${m.role === "protect" ? "text-emerald-400/10" : "text-primary/20"} stroke-current ${m.role === "protect" ? "text-emerald-400" : "text-primary/70"}`}
                        strokeWidth="2"
                      />
                    </svg>
                    <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap rounded bg-background/80 px-1 font-mono text-[9px] uppercase">
                      {m.label || m.role}
                    </span>
                  </div>
                );
              }

              if (m.kind === "brush" && m.points) {
                return (
                  <svg
                    key={m.id}
                    onClick={() => tool === "select" && setSelected(m.id)}
                    className={`absolute inset-0 size-full ${tool === "select" ? "cursor-pointer" : "pointer-events-none"}`}
                    preserveAspectRatio="none"
                  >
                    {m.points.map((pt, i) => (
                      <circle
                        key={i}
                        cx={`${pt.x * 100}%`}
                        cy={`${pt.y * 100}%`}
                        r={`${(m.size ?? 0.01) * 50}%`}
                        className={`${m.role === "protect" ? "fill-emerald-400/30 stroke-emerald-400" : "fill-primary/40 stroke-primary/70"}`}
                        strokeWidth="1"
                      />
                    ))}
                  </svg>
                );
              }

              return (
                <div
                  key={m.id}
                  onClick={() => tool === "select" && setSelected(m.id)}
                  className={`absolute border-2 ${baseClasses} ${tool === "select" ? "cursor-pointer" : ""}`}
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
              );
            })}

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
          {(
            [
              ["rect", "Retângulo", Square],
              ["poly", "Polígono", Pentagon],
              ["brush", "Pincel", PenTool],
              ["protect", "Proteger", Shield],
              ["erase", "Apagar", Eraser],
              ["select", "Selecionar", MousePointer2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTool(id)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                tool === id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/60 bg-surface/40"
              }`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {time.toFixed(2)}s / {duration.toFixed(2)}s
          </span>
        </div>

        {tool === "poly" && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
            <span>Clique para adicionar pontos. Duplo-clique ou Enter fecha o polígono.</span>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={finishPolygon}>
                Fechar
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelPolygon}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {tool === "brush" && (
          <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface/40 p-2 text-xs">
            <span className="mono-label">Tamanho</span>
            <input
              type="range"
              min={0.005}
              max={0.06}
              step={0.001}
              value={brushSize}
              onChange={(e) => setBrushSize(parseFloat(e.target.value))}
              className="w-32"
            />
            <span className="font-mono">{Math.round(brushSize * 1000)}</span>
          </div>
        )}

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
                  style={{
                    left: `${from}%`,
                    width: `${Math.max(2, to - from)}%`,
                    top: `${(i % 3) * 18 + 2}px`,
                  }}
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
                onClick={() =>
                  setMasks((p) => p.map((m) => (m.id === sel.id ? { ...m, from: time } : m)))
                }
              >
                Início aqui
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setMasks((p) => p.map((m) => (m.id === sel.id ? { ...m, to: time } : m)))
                }
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
                    setMasks((p) =>
                      p.map((m) => (m.id === sel.id ? { ...m, track: e.target.checked } : m)),
                    )
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
            <button
              type="button"
              onClick={() => {
                setHealth(null);
                getHealth()
                  .then((h) =>
                    setHealth(
                      h as {
                        online: boolean;
                        ai_ready?: boolean;
                        max_ready?: boolean;
                        reason?: string;
                      },
                    ),
                  )
                  .catch((e) => setHealth({ online: false, reason: String(e) }));
              }}
              title={
                health?.online && !health.ai_ready
                  ? "worker online; ProPainter ainda não está pronto"
                  : "verificar novamente"
              }
              className={`flex items-center gap-1.5 text-[10px] font-bold uppercase ${
                health === null
                  ? "text-muted-foreground"
                  : health.online && health.ai_ready
                    ? "text-emerald-500"
                    : health.online
                      ? "text-amber-500"
                      : "text-destructive"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  health === null
                    ? "animate-pulse bg-muted-foreground"
                    : health.online && health.ai_ready
                      ? "animate-pulse bg-emerald-500"
                      : health.online
                        ? "bg-amber-500"
                        : "bg-destructive"
                }`}
              />
              {health === null
                ? "verificando…"
                : health.online && health.ai_ready
                  ? "IA pronta"
                  : health.online && health.cuda === false
                    ? "modo CPU"
                  : health.online
                    ? "modo básico"
                    : "offline"}
            </button>
          </div>

          <div className="space-y-2">
            <span className="mono-label">Qualidade</span>
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => !job && setPreset(p)}
                disabled={
                  !!job ||
                  (p === "quality" && health?.online === true && health.ai_ready === false) ||
                  (p === "max" && health?.online === true && health.max_ready === false)
                }
                title={
                  p === "max" && health?.online && !health.max_ready
                    ? "DiffuEraser não está pronto no worker"
                    : p === "quality" && health?.online && !health.ai_ready
                      ? "ProPainter não está pronto no worker"
                      : undefined
                }
                className={`w-full rounded-lg border p-2.5 text-left text-xs transition ${
                  preset === p
                    ? "border-primary bg-primary/10"
                    : "border-border/60 bg-background/40"
                } disabled:opacity-60`}
              >
                <span className="block font-semibold">{PRESET_LABEL[p]}</span>
                <span className="block text-[10px] text-muted-foreground">{PRESET_HINT[p]}</span>
              </button>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 p-3">
            <span className="mono-label">Precisão</span>
            {[
              {
                key: "dyn",
                on: dynamicMask,
                set: setDynamicMask,
                title: "Máscara dinâmica",
                hint: "Máscara recalculada quadro a quadro — acompanha texto ou objeto que muda durante o vídeo",
              },
              {
                key: "prot",
                on: protectSubject,
                set: setProtectSubject,
                title: "Proteger pessoa/rosto",
                hint: "Impede que a reconstrução invada o sujeito",
              },
              {
                key: "ver",
                on: verifyPass,
                set: setVerifyPass,
                title: "Verificar resultado",
                hint: "Confere texto residual e nitidez; reprocessa o trecho falho automaticamente",
              },
              {
                key: "crop",
                on: cropClean,
                set: setCropClean,
                title: "Legenda por recorte limpo",
                hint: "Remove legendas dinÃ¢micas reenquadrando como no teste aprovado",
              },
              {
                key: "enh",
                on: enhanceOutput,
                set: setEnhanceOutput,
                title: "Melhorar qualidade",
                hint: "Exporta em HQ com nitidez reforÃ§ada apÃ³s limpar o vÃ­deo",
              },
            ].map((o) => (
              <label key={o.key} className="flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={o.on}
                  disabled={polling}
                  onChange={(e) => o.set(e.target.checked)}
                  className="mt-0.5 size-3.5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-semibold">{o.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {!job || !inputReady ? (
            <Button
              className="w-full shadow-glow"
              onClick={startUpload}
              disabled={!health?.online || uploading}
            >
              <Upload className="mr-2 size-4" /> {job ? "Reenviar vídeo" : "Enviar para IA"}
            </Button>
          ) : job.status === "completed" ? (
            <a
              href={job.result_url ?? "#"}
              download
              onClick={() => {
                const id = job.id;
                window.setTimeout(() => {
                  void cleanupRemoteJob({ data: { id } });
                }, 15000);
              }}
              className="block w-full rounded-lg bg-primary py-2 text-center text-sm font-semibold text-primary-foreground"
            >
              Baixar vídeo limpo
            </a>
          ) : (
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleDetect}
                disabled={polling || !inputReady}
              >
                <Target className="mr-2 size-4" /> Detectar
              </Button>
              <Button
                className="w-full shadow-glow"
                onClick={handleProcess}
                disabled={polling || !inputReady}
              >
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
                    selected === m.id
                      ? "border-primary bg-primary/10"
                      : "border-border/50 bg-background/50"
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
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-[10px] uppercase tracking-widest"
              onClick={() => setMasks([])}
            >
              Limpar todas
            </Button>
          )}
        </section>

        {job?.metrics && (
          <section className="space-y-2 rounded-2xl border border-border/70 bg-surface/50 p-4 text-[11px]">
            <p className="mono-label">Relatório de qualidade</p>
            {(() => {
              const m = job.metrics as Record<string, unknown>;
              const num = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : null);
              const text = num("residual_text");
              const sharp = num("sharpness_ratio");
              const temporal = num("temporal_consistency");
              const rows: Array<[string, string, boolean]> = [];
              if (text !== null)
                rows.push([
                  "Texto residual",
                  text <= 0.001 ? "nenhum" : `${(text * 100).toFixed(1)}% da área`,
                  text <= 0.02,
                ]);
              if (sharp !== null)
                rows.push(["Nitidez vs. entorno", `${sharp.toFixed(2)}x`, sharp >= 0.7]);
              if (temporal !== null)
                rows.push([
                  "Estabilidade no tempo",
                  `${(temporal * 100).toFixed(0)}%`,
                  temporal >= 0.7,
                ]);
              if (typeof m["engine"] === "string") rows.push(["Motor", String(m["engine"]), true]);
              if (typeof m["device"] === "string")
                rows.push(["Dispositivo", String(m["device"]), true]);
              return rows.map(([label, value, ok]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{label}</span>
                  <span
                    className={
                      ok ? "font-semibold text-emerald-500" : "font-semibold text-amber-500"
                    }
                  >
                    {value}
                  </span>
                </div>
              ));
            })()}
            {Array.isArray((job as unknown as { segments?: unknown }).segments) && (
              <div className="mt-2 space-y-1">
                <p className="mono-label">Trechos limpos</p>
                <div className="flex flex-wrap gap-1">
                  {(
                    (job as unknown as { segments: Array<Record<string, number>> }).segments || []
                  ).map((seg, i) => {
                    const bad =
                      (seg["residual_text"] ?? 0) > 0.02 || (seg["sharpness_ratio"] ?? 1) < 0.7;
                    return (
                      <span
                        key={i}
                        title={`${seg["from"]}s – ${seg["to"]}s`}
                        className={`rounded px-1.5 py-0.5 text-[9px] font-mono ${
                          bad
                            ? "bg-amber-500/20 text-amber-500"
                            : "bg-emerald-500/15 text-emerald-500"
                        }`}
                      >
                        {Math.round(seg["from"] ?? 0)}s
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {health && !health.online && (
          <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-4 text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="text-[11px] leading-relaxed">
              <p className="font-bold uppercase tracking-tight">Backend offline</p>
              <p className="opacity-80">{health.reason || "processamento local não configurado"}</p>
            </div>
          </div>
        )}

        {health?.online && health.cuda === false && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-4 text-amber-600">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div className="text-[11px] leading-relaxed">
              <p className="font-bold uppercase">Processamento em CPU</p>
              <p className="opacity-80">O motor está disponível, mas vídeos podem demorar mais.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
