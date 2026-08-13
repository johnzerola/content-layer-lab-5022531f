import { useState, useRef, useEffect } from "react";
import {
  Scissors,
  Play,
  Pause,
  StepBack,
  StepForward,
  Undo2,
  Redo2,
  RotateCcw,
  X,
  Type,
  Subtitles,
  SlidersHorizontal,
  AudioLines,
  Camera,
  LayoutTemplate,
  Grid3X3,
  Shield,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { EditorTimeline } from "./EditorTimeline";
import { StagePreview } from "./StagePreview";
import { toast } from "sonner";

// Local minimal types to decouple from template.ts for now
interface PreEdit {
  start: number;
  end: number;
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  crop: { x: number; y: number; w: number; h: number };
  keys: any[];
  segments: any[];
  captions: any[];
}

const defaultPre = (): PreEdit => ({
  start: 0,
  end: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  blur: 0,
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  keys: [],
  segments: [],
  captions: [],
});

interface VideoStudioProps {
  file: File;
  onSave: (data: { pre: any; clip: { start: number; end: number } | null }) => void;
  onClose: () => void;
  initial?: { pre: any; clip: { start: number; end: number } | null };
}

export function VideoStudio({ file, onSave, onClose, initial }: VideoStudioProps) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState("trim");
  const [view, setView] = useState<"src" | "out">("out");
  const [pre, setPre] = useState<PreEdit>(initial?.pre || defaultPre());
  const [compare, setCompare] = useState(false);
  const [thirds, setThirds] = useState(false);
  const [safe, setSafe] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => {
      setDuration(v.duration);
      if (!initial?.pre) setPre(p => ({ ...p, end: v.duration }));
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

  const setPatch = (patch: Partial<PreEdit>) => setPre(p => ({ ...p, ...patch }));

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
      items: [{ id: "audio", label: "Áudio", icon: AudioLines }],
    },
  ];

  const toolLabel = TOOL_GROUPS.flatMap(g => g.items).find(i => i.id === tab)?.label || "";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/98 p-0 sm:p-2">
      <div className="flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-none sm:rounded-2xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-surface-1/50">
          <div className="flex items-center gap-4">
            <Scissors className="size-4 text-primary" />
            <h2 className="text-sm font-black uppercase tracking-tighter">Editor Profissional</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onClose}><X className="size-4" /></Button>
            <Button size="sm" onClick={() => onSave({ pre, clip: { start: pre.start, end: pre.end } })}>Concluir</Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row overflow-hidden">
          <nav className="flex md:flex-col gap-1 border-r border-border p-2 bg-surface-1/30 w-full md:w-[84px] items-center">
            {TOOL_GROUPS.flatMap(g => g.items).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex flex-col items-center justify-center size-[64px] rounded-xl transition ${
                  tab === t.id ? "bg-primary text-primary-foreground shadow-glow-sm" : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <t.icon className="size-5 mb-1" />
                <span className="text-[9px] font-bold uppercase">{t.label}</span>
              </button>
            ))}
          </nav>

          <div className="flex flex-1 flex-col bg-background/50">
            <div className="relative flex-1 flex flex-col p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex bg-surface-2 p-1 rounded-lg border border-border">
                  <button onClick={() => setView("out")} className={`px-3 py-1 text-[11px] font-bold rounded-md ${view === "out" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>PREVIEW</button>
                  <button onClick={() => setView("src")} className={`px-3 py-1 text-[11px] font-bold rounded-md ${view === "src" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>FONTE</button>
                </div>
              </div>

              <div className="relative flex-1 flex items-center justify-center bg-black/40 rounded-3xl border border-border/50 overflow-hidden">
                <video
                  ref={videoRef}
                  src={url}
                  className="max-h-full object-contain"
                  style={{
                    filter: `brightness(${pre.brightness}) contrast(${pre.contrast}) saturate(${pre.saturation}) blur(${pre.blur}px)`,
                    transform: `rotate(${pre.rotate}deg) scaleX(${pre.flipH ? -1 : 1}) scaleY(${pre.flipV ? -1 : 1})`
                  }}
                />
              </div>

              <div className="flex items-center justify-center gap-4 py-4">
                <Button variant="ghost" size="icon" onClick={() => seek(time - 1)}><StepBack className="size-5" /></Button>
                <Button onClick={toggle} className="size-12 rounded-full bg-primary">{playing ? <Pause /> : <Play className="ml-1" />}</Button>
                <Button variant="ghost" size="icon" onClick={() => seek(time + 1)}><StepForward className="size-5" /></Button>
              </div>
            </div>

            <div className="border-t border-border p-4 bg-surface-1/50">
              <EditorTimeline
                url={url}
                duration={duration}
                time={time}
                playing={playing}
                start={pre.start}
                end={pre.end}
                onSeek={seek}
                onTogglePlay={toggle}
                onTrim={(s, e) => setPatch({ start: s, end: e })}
                keys={pre.keys}
                segments={pre.segments}
                onKeysChange={keys => setPatch({ keys })}
              />
            </div>
          </div>

          <aside className="w-full md:w-[320px] border-l border-border bg-surface-1/40 p-4 overflow-y-auto">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-primary mb-4">{toolLabel}</h3>
            <div className="space-y-6">
              {tab === "trim" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-muted-foreground uppercase">Início: {pre.start.toFixed(2)}s</span>
                    <Slider value={[pre.start]} max={duration} step={0.1} onValueChange={([v]) => setPatch({ start: v })} />
                  </div>
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-muted-foreground uppercase">Fim: {pre.end.toFixed(2)}s</span>
                    <Slider value={[pre.end]} max={duration} step={0.1} onValueChange={([v]) => setPatch({ end: v })} />
                  </div>
                </div>
              )}
              {tab === "color" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-muted-foreground uppercase">Brilho</span>
                    <Slider value={[pre.brightness]} min={0} max={2} step={0.01} onValueChange={([v]) => setPatch({ brightness: v })} />
                  </div>
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-muted-foreground uppercase">Desfoque</span>
                    <Slider value={[pre.blur]} min={0} max={10} step={0.1} onValueChange={([v]) => setPatch({ blur: v })} />
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
