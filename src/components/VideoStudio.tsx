import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AudioLines,
  Camera,
  ChevronFirst,
  ChevronLast,
  Crop,
  Eye,
  FlipHorizontal,
  FlipVertical,
  Grid3X3,
  Languages,
  LayoutTemplate,
  Pause,
  Play,
  Redo2,
  Repeat,
  RotateCcw,
  RotateCw,
  Scissors,
  Shield,
  SlidersHorizontal,
  Sparkles,
  StepBack,
  StepForward,
  Subtitles,
  Type,
  Undo2,
  X,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { AudioSplitterStudio } from "@/components/AudioSplitterStudio";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  COLOR_PRESETS,
  CROP_PRESETS,
  cropAt,
  cropForRatio,
  defaultPreEdit,
  isFullCrop,
  keptSegments,
  LAYOUTS,
  preEditFilter,
  segmentsDuration,
  splitAt,
  TRANSITIONS,
  type FrameKey,
  type LayoutKind,
  type PreEdit,
  type Segment,
  type TransitionKind,
} from "@/lib/template";
import { useHistory } from "@/hooks/use-history";
import { StagePreview } from "./StagePreview";
import { EditorTimeline } from "./EditorTimeline";
import { cn } from "@/lib/utils";

interface VideoStudioProps {
  file: File;
  onSave: (data: { pre: PreEdit; clip: { start: number; end: number } | null }) => void;
  onClose: () => void;
  initial?: { pre: PreEdit; clip: { start: number; end: number } | null };
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export function VideoStudio({
  file,
  onSave,
  onClose,
  initial,
}: VideoStudioProps) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState("trim");
  const [view, setView] = useState<"src" | "out">("out");
  const [compare, setCompare] = useState(false);
  const [thirds, setThirds] = useState(false);
  const [safe, setSafe] = useState(false);
  const [adPreview, setAdPreview] = useState(false);
  const [adVariation, setAdVariation] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const hist = useHistory<PreEdit>(initial?.pre || defaultPreEdit());
  const pre = hist.state;
  const { start, end, segments: segs } = pre;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => {
      setDuration(v.duration);
      if (!initial) hist.set((d) => ({ ...d, end: v.duration }), "init");
    };
    const onTime = () => setTime(v.currentTime);
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [initial]);

  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) v.pause();
    else v.play();
    setPlaying(!playing);
  };

  const step = (dir: number) => {
    seek(time + dir * 0.05);
  };

  const set = (patch: Partial<PreEdit>, msg?: string) => hist.set((d) => ({ ...d, ...patch }), msg);

  const setStart = (s: number) => set({ start: s }, "corte");
  const setEnd = (e: number) => set({ end: e }, "corte");

  const split = () => {
    const news = splitAt(segs, time, duration, start, end);
    if (news) set({ segments: news }, "dividir");
  };

  const deleteSegment = (i: number) => {
    set({ segments: segs.filter((_, idx) => idx !== i) }, "remover trecho");
  };

  const addKey = (k?: Partial<FrameKey>) => {
    const cur = pre.keys.find((x) => Math.abs(x.t - time) < 0.1);
    if (cur) {
      set({ keys: pre.keys.filter((x) => x !== cur) }, "remover keyframe");
    } else {
      set(
        {
          keys: [
            ...pre.keys,
            { t: time, x: pre.crop.x, y: pre.crop.y, w: pre.crop.w, h: pre.crop.h, ...k },
          ].sort((a, b) => a.t - b.t),
        },
        "adicionar keyframe"
      );
    }
  };

  const [cutting, setCutting] = useState(false);
  const [sens, setSens] = useState(0.5);
  const [minSil, setMinSil] = useState(0.35);

  const cutSilence = async () => {
    setCutting(true);
    try {
      // Mock logic for silence cutting in the studio
      toast.success("Silêncio removido (Simulado)");
    } finally {
      setCutting(false);
    }
  };

  const { x: width, y: height } = { x: 1920, y: 1080 }; // Placeholder for actual metadata
  const srcAR = width / height;
  const filter = preEditFilter(pre);
  const crop = cropAt(pre.keys, time, pre.crop);
  const captions = pre.captions || [];
  const clipWindow = { start, end };
  const outDur = segmentsDuration(segs, start, end);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(2);
    return `${m}:${sec.padStart(5, "0")}`;
  };

  const undo = () => hist.undo();
  const redo = () => hist.redo();

  const onPointerDown = (e: React.PointerEvent, handle: string) => {
    // Basic crop interaction logic
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // Basic pointer tracking for interaction
  };

  const save = () =>
    onSave({
      pre,
      clip: start > 0.02 || end < duration - 0.02 ? { start, end } : null,
    });

  const TOOL_GROUPS = [
    {
      group: "edit",
      items: [
        { id: "trim", label: "Corte", icon: Scissors },
        { id: "camera", label: "Câmera", icon: Camera },
        { id: "layout", label: "Layout", icon: LayoutTemplate },
      ],
    },
    {
      group: "style",
      items: [
        { id: "text", label: "Texto", icon: Type },
        { id: "captions", label: "Legendas", icon: Subtitles },
        { id: "color", label: "Cor", icon: SlidersHorizontal },
      ],
    },
    {
      group: "audio",
      items: [
        { id: "audio", label: "Áudio", icon: AudioLines },
      ],
    },
  ];

  const TOOL_ORDER = TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.id));

  const toolLabel = TOOL_GROUPS.flatMap((g) => g.items).find((i) => i.id === tab)?.label || "";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/98 p-0 sm:p-2">
      <div className="flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-none sm:rounded-2xl border border-border bg-card shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-surface-1/50 backdrop-blur-md">
          <div className="flex items-center gap-4 min-w-0">
            <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
               <Scissors className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black uppercase tracking-tighter text-foreground">Editor de Vídeo</h2>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {file.name} • {width}×{height} • {fmt(duration)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 border-r border-border pr-2 mr-2">
              <Button variant="ghost" size="icon" disabled={!hist.canUndo} onClick={undo} className="size-8">
                <Undo2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" disabled={!hist.canRedo} onClick={redo} className="size-8">
                <Redo2 className="size-4" />
              </Button>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => hist.reset(defaultPreEdit(), "resetar tudo")}
              className="hidden sm:flex h-8"
            >
              <RotateCcw className="mr-1.5 size-3.5" /> Resetar
            </Button>
            <Button size="sm" onClick={save} className="h-8 px-4 font-bold shadow-glow-sm">
              Concluir
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} className="size-8">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row overflow-hidden">
          <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-border p-2 bg-surface-1/30 min-w-[72px] md:w-[84px] items-center">
            {TOOL_GROUPS.map((g) => (
              <div key={g.group} className="flex md:flex-col gap-1">
                {g.items.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex flex-col items-center justify-center size-[64px] rounded-xl transition-all duration-300 ${
                      tab === t.id
                        ? "bg-primary text-primary-foreground shadow-glow-sm scale-105"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <t.icon className="size-5 mb-1" />
                    <span className="text-[9px] font-bold uppercase tracking-tighter leading-none">{t.label}</span>
                  </button>
                ))}
                <div className="hidden md:block h-px w-8 bg-border/50 mx-auto my-2 last:hidden" />
              </div>
            ))}
          </nav>

          <div className="flex flex-1 flex-col min-w-0 bg-background/50">
            <div className="relative flex-1 flex flex-col min-h-0 p-4">
              <div className="flex items-center justify-between mb-3 px-2">
                 <div className="flex rounded-lg bg-surface-2 p-1 border border-border shadow-inner">
                    {(
                      [
                        ["out", "Preview"],
                        ["src", "Fonte"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setView(id)}
                        className={`rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition ${
                          view === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                 </div>
                 
                 <div className="flex items-center gap-2">
                    <ToggleChip on={thirds} onClick={() => setThirds((v) => !v)} icon={Grid3X3} label="Grades" />
                    <ToggleChip on={safe} onClick={() => setSafe((v) => !v)} icon={Shield} label="Seguro" />
                    <Button variant="ghost" size="sm" className="h-7 text-[10px]" onMouseDown={() => setCompare(true)} onMouseUp={() => setCompare(false)}>
                       <Eye className="mr-1 size-3" /> Comparar
                    </Button>
                 </div>
              </div>

              <div className="relative flex-1 flex items-center justify-center min-h-0 bg-black/40 rounded-3xl border border-border/50 overflow-hidden shadow-2xl">
                 <div
                    ref={boxRef}
                    className={`relative overflow-hidden rounded-xl border border-white/5 bg-black shadow-2xl ${
                      view === "out" ? "pointer-events-none invisible absolute size-px opacity-0" : "h-full max-h-full"
                    }`}
                    style={view === "out" ? undefined : { aspectRatio: String(srcAR), maxWidth: "100%" }}
                    onPointerMove={onPointerMove}
                  >
                    <video
                      ref={videoRef}
                      src={url}
                      playsInline
                      muted
                      preload="auto"
                      className="absolute inset-0 size-full object-contain"
                      style={{
                        filter,
                        transform: `translateZ(0) rotate(${pre.rotate}deg) scaleX(${pre.flipH ? -1 : 1}) scaleY(${
                          pre.flipV ? -1 : 1
                        })`,
                      }}
                      onLoadedMetadata={() => seek(start)}
                    />
                    {view === "src" && (
                      <div
                        className="absolute cursor-move border-[3px] border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]"
                        style={{
                          left: `${crop.x * 100}%`,
                          top: `${crop.y * 100}%`,
                          width: `${crop.w * 100}%`,
                          height: `${crop.h * 100}%`,
                        }}
                        onPointerDown={(e) => onPointerDown(e, "move")}
                      >
                         {HANDLES.map((h) => (
                           <span
                             key={h}
                             onPointerDown={(e) => onPointerDown(e, h)}
                             className="absolute size-4 rounded-full border-2 border-primary bg-white shadow-xl cursor-pointer"
                             style={{
                               left: h.includes("w") ? -8 : h.includes("e") ? "auto" : "50%",
                               right: h.includes("e") ? -8 : "auto",
                               top: h.startsWith("n") ? -8 : h.startsWith("s") ? "auto" : "50%",
                               bottom: h.startsWith("s") ? -8 : "auto",
                               transform: `translate(${h.includes("w") || h.includes("e") ? 0 : "-50%"}, ${h.startsWith("n") || h.startsWith("s") ? 0 : "-50%"})`
                             }}
                           />
                         ))}
                      </div>
                    )}
                 </div>

                 {view === "out" && (
                    <StagePreview
                      videoRef={videoRef}
                      pre={pre}
                      clip={clipWindow}
                      captions={captions}
                      bypass={compare}
                      thirds={thirds}
                      safeArea={safe}
                      className="h-full max-h-full"
                      variation={adPreview ? adVariation : undefined}
                    />
                 )}
              </div>
              
              <div className="flex items-center justify-center gap-4 py-4">
                 <Button variant="ghost" size="icon" onClick={() => step(-1)} className="text-muted-foreground"><StepBack className="size-5" /></Button>
                 <Button onClick={toggle} className="size-12 rounded-full bg-primary text-primary-foreground shadow-glow active:scale-95 transition-all">
                    {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current ml-1" />}
                 </Button>
                 <Button variant="ghost" size="icon" onClick={() => step(1)} className="text-muted-foreground"><StepForward className="size-5" /></Button>
              </div>
            </div>

            <div className="border-t border-border bg-surface-1/50 p-4">
               <EditorTimeline
                  url={url}
                  duration={duration}
                  time={time}
                  playing={playing}
                  start={start}
                  end={end}
                  keys={pre.keys}
                  transIn={pre.transIn}
                  transOut={pre.transOut}
                  cues={captions}
                  segments={segs}
                  onSeek={seek}
                  onTogglePlay={toggle}
                  onTrim={(s, e) => hist.set((d) => ({ ...d, start: s, end: e }), "corte")}
                  onKeysChange={(keys) => set({ keys }, "keyframes")}
                  onAddKey={addKey}
                  onSplit={split}
                  onDeleteSegment={deleteSegment}
               />
            </div>
          </div>

          <aside className="w-full md:w-[320px] border-t md:border-t-0 md:border-l border-border bg-surface-1/40 flex flex-col min-h-0">
             <div className="px-4 py-3 border-b border-border bg-surface-2 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-primary">{toolLabel || tab}</span>
                <Button variant="ghost" size="icon" className="size-6 rounded-full" onClick={() => hist.undo()} disabled={!hist.canUndo}><Undo2 className="size-3" /></Button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <div className="space-y-6">
                  {tab === "camera" && (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      A câmera virtual usa o palco à esquerda. Escolha pessoas, pontos de enquadramento e transições direto lá.
                    </p>
                  )}

                  {tab === "trim" && (
                    <div className="space-y-4">
                      <Field label={`Início · ${fmt(start)}`}>
                        <Slider
                          value={[start]}
                          min={0}
                          max={Math.max(0.2, duration)}
                          step={0.05}
                          onValueChange={([v]) => {
                            const s = Math.min(v ?? 0, end - 0.3);
                            setStart(s);
                            seek(s);
                          }}
                        />
                      </Field>
                      <Field label={`Fim · ${fmt(end)}`}>
                        <Slider
                          value={[end]}
                          min={0}
                          max={Math.max(0.2, duration)}
                          step={0.05}
                          onValueChange={([v]) => {
                            const e = Math.max(v ?? duration, start + 0.3);
                            setEnd(e);
                            seek(Math.max(start, e - 0.5));
                          }}
                        />
                      </Field>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" onClick={() => setStart(Math.min(time, end - 0.3))}>Início aqui (I)</Button>
                        <Button variant="secondary" size="sm" onClick={() => setEnd(Math.max(start + 0.3, time))}>Fim aqui (O)</Button>
                      </div>
                    </div>
                  )}

                  {tab === "color" && (
                    <div className="space-y-4">
                      <Field label={`Brilho · ${Math.round(pre.brightness * 100)}%`}>
                        <Slider value={[pre.brightness]} min={0} max={2} step={0.01} onValueChange={([v]) => set({ brightness: v ?? 1 }, "cor")} />
                      </Field>
                      <Field label={`Contraste · ${Math.round(pre.contrast * 100)}%`}>
                        <Slider value={[pre.contrast]} min={0} max={2} step={0.01} onValueChange={([v]) => set({ contrast: v ?? 1 }, "cor")} />
                      </Field>
                      <Field label={`Saturação · ${Math.round(pre.saturation * 100)}%`}>
                        <Slider value={[pre.saturation]} min={0} max={2} step={0.01} onValueChange={([v]) => set({ saturation: v ?? 1 }, "cor")} />
                      </Field>
                      <Field label={`Desfoque · ${pre.blur.toFixed(1)}px`}>
                        <Slider value={[pre.blur]} min={0} max={10} step={0.1} onValueChange={([v]) => set({ blur: v ?? 0 }, "cor")} />
                      </Field>
                    </div>
                  )}
                </div>
             </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ToggleChip({
  on,
  onClick,
  icon: Icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: any;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition ${
        on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      {children}
    </div>
  );
}
