import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AudioLines,
  Music,
  Mic,
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
  Plus,
  Trash2,
  History,
  Layers,
  ArrowRight,
  Monitor,
  Maximize,
  Volume2,
  Timer,
  Palette,
  Captions,
  Settings,
} from "lucide-react";
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
  type TransitionKind,
} from "@/lib/preedit";
import { translateWords } from "@/lib/translate.functions";
import { detectSpeechSegments } from "@/lib/silence";
import { CaptionTimeline } from "@/components/CaptionTimeline";
import { FramingStudio } from "@/components/FramingStudio";
import { EditorTimeline } from "@/components/EditorTimeline";
import { StagePreview } from "@/components/editor/StagePreview";
import { useEditorHistory } from "@/components/editor/useEditorHistory";
import type { CaptionCue } from "@/lib/captions";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface PreEditResult {
  pre: PreEdit;
  clip: { start: number; end: number } | null;
}

type Props = {
  file: File;
  /** dimensões e duração do vídeo original */
  width: number;
  height: number;
  duration: number;
  value: PreEditResult;
  /** legendas deste vídeo (permite corrigir palavras aqui mesmo) */
  captions?: CaptionCue[] | undefined;
  onCaptionsChange?: ((cues: CaptionCue[]) => void) | undefined;
  /** textos do template usados neste vídeo */
  texts?: { headline: string; name: string; handle: string; cta: string } | undefined;
  onTextsChange?: ((t: { headline: string; name: string; handle: string; cta: string }) => void) | undefined;
  onClose: () => void;
  onSave: (v: PreEditResult) => void;
};

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

type Handle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e";
type Drag = {
  mode: "move" | Handle;
  x: number;
  y: number;
  crop: NonNullable<PreEdit["crop"]>;
  /** instante do vídeo quando o arraste começou (para gravar o keyframe certo) */
  t: number;
};

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const TOOL_GROUPS: { group: string; items: { id: Tab; label: string; icon: any; shortcut: string }[] }[] = [
  {
    group: "Ferramentas",
    items: [
      { id: "trim", label: "Corte", icon: Scissors, shortcut: "S" },
      { id: "crop", label: "Enquadrar", icon: Maximize, shortcut: "C" },
      { id: "trans", label: "Transições", icon: ArrowRight, shortcut: "T" },
    ],
  },
  {
    group: "Design",
    items: [
      { id: "layout", label: "Layout", icon: LayoutTemplate, shortcut: "L" },
      { id: "color", label: "Ajustes", icon: SlidersHorizontal, shortcut: "A" },
      { id: "camera", label: "IA Motion", icon: Sparkles, shortcut: "M" },
    ],
  },
  {
    group: "Áudio & Texto",
    items: [
      { id: "caps", label: "Legendas", icon: Captions, shortcut: "G" },
      { id: "audio", label: "Mixagem", icon: Volume2, shortcut: "V" },
      { id: "text", label: "Títulos", icon: Type, shortcut: "H" },
    ],
  },
];

type Tab = "trim" | "layout" | "crop" | "camera" | "keys" | "trans" | "color" | "caps" | "text" | "audio";
const TOOL_ORDER: Tab[] = TOOL_GROUPS.flatMap((g) => g.items.map((i) => i.id));

/** Miniatura esquemática de cada layout (9:16). */
function LayoutGlyph({ id }: { id: LayoutKind }) {
  const box = "absolute rounded-[2px] bg-primary/60";
  return (
    <span className="relative block h-10 w-[22px] shrink-0 overflow-hidden rounded border border-border bg-muted">
      {id === "fill" && <span className={`${box} inset-0`} />}
      {(id === "fit" || id === "horizontal") && <span className={`${box} inset-x-0 top-1/2 h-3 -translate-y-1/2`} />}
      {id === "auto" && <span className={`${box} inset-x-0 top-1/2 h-6 -translate-y-1/2`} />}
      {id === "blur" && (
        <>
          <span className="absolute inset-0 bg-primary/20 blur-[2px]" />
          <span className={`${box} inset-x-0 top-1/2 h-4 -translate-y-1/2`} />
        </>
      )}
      {id === "centered" && (
        <>
          <span className="absolute inset-0 bg-primary/15" />
          <span className={`${box} inset-x-[2px] top-1/2 h-3 -translate-y-1/2`} />
        </>
      )}
      {id === "split" && (
        <>
          <span className={`${box} inset-x-0 top-0 h-[19px]`} />
          <span className={`${box} inset-x-0 bottom-0 h-[19px] opacity-60`} />
        </>
      )}
      {id === "trio" && (
        <>
          <span className={`${box} inset-x-0 top-0 h-[12px]`} />
          <span className={`${box} inset-x-0 top-[13px] h-[12px] opacity-80`} />
          <span className={`${box} inset-x-0 bottom-0 h-[12px] opacity-60`} />
        </>
      )}
      {id === "spotlight" && (
        <>
          <span className={`${box} inset-x-0 top-0 h-[26px]`} />
          <span className={`${box} inset-x-0 bottom-0 h-[12px] opacity-50`} />
        </>
      )}
    </span>
  );
}

const LANGS = [
  { id: "inglês", label: "Inglês" },
  { id: "espanhol", label: "Espanhol" },
  { id: "português do Brasil", label: "Português" },
  { id: "francês", label: "Francês" },
  { id: "alemão", label: "Alemão" },
  { id: "italiano", label: "Italiano" },
  { id: "japonês", label: "Japonês" },
  { id: "hindi", label: "Hindi" },
];

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

interface Doc {
  pre: PreEdit;
  start: number;
  end: number;
}

/** Estúdio de edição: palco com preview real, trilha de ferramentas, inspetor e timeline. */
export function VideoStudio({
  file,
  width,
  height,
  duration,
  value,
  captions,
  onCaptionsChange,
  texts,
  onTextsChange,
  onClose,
  onSave,
}: Props) {
  const hist = useEditorHistory<Doc>({
    pre: value.pre ?? defaultPreEdit(),
    start: value.clip?.start ?? 0,
    end: value.clip?.end ?? duration,
  });
  const { pre, start, end } = hist.state;
  const setHistory = hist.set;

  const setPre = useCallback(
    (next: PreEdit | ((v: PreEdit) => PreEdit), label = "edição") =>
      setHistory((d) => ({ ...d, pre: typeof next === "function" ? next(d.pre) : next }), label),
    [setHistory],
  );
  const set = (p: Partial<PreEdit>, label = "ajuste") => setPre((v) => ({ ...v, ...p }), label);
  const setStart = useCallback(
    (s: number) => setHistory((d) => ({ ...d, start: s }), "entrada"),
    [setHistory],
  );
  const setEnd = useCallback(
    (e: number) => setHistory((d) => ({ ...d, end: e }), "saída"),
    [setHistory],
  );

  const [tab, setTab] = useState<Tab>("trim");
  const [view, setView] = useState<"out" | "src">("out");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(value.clip?.start ?? 0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [compare, setCompare] = useState(false);
  const [thirds, setThirds] = useState(false);
  const [safe, setSafe] = useState(false);
  const [draft, setDraft] = useState(texts ?? { headline: "", name: "", handle: "", cta: "" });
  const [lang, setLang] = useState(LANGS[0]!.id);
  const [translating, setTranslating] = useState(false);
  const [sens, setSens] = useState(0.5);
  const [minSil, setMinSil] = useState(0.35);
  const [cutting, setCutting] = useState(false);
  /** proporção travada do recorte (largura/altura em pixels da fonte) */
  const [lock, setLock] = useState<number | null>(null);
  const [separating, setSeparating] = useState(false);

  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => {
      setUrl("");
      URL.revokeObjectURL(u);
    };
  }, [file]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);

  /** recorte mostrado agora: segue os keyframes quando existirem */
  const crop = useMemo(
    () => cropAt(pre, time) ?? pre.crop ?? { x: 0, y: 0, w: 1, h: 1 },
    [pre, time],
  );

  /** tolerância para considerar que o playhead está "em cima" de um keyframe */
  const SNAP = 0.2;
  const nearKey = pre.keys.find((k) => Math.abs(k.t - time) <= SNAP) ?? null;

  /** aplica um recorte: sem keyframes vira recorte fixo; com keyframes grava/edita o ponto atual */
  const applyCrop = (next: NonNullable<PreEdit["crop"]>, at: number) =>
    setPre((v) => {
      if (v.keys.length === 0) return { ...v, crop: next };
      const t = Number(at.toFixed(2));
      const i = v.keys.findIndex((k) => Math.abs(k.t - t) <= SNAP);
      const keys =
        i >= 0
          ? v.keys.map((k, j) => (j === i ? { t: k.t, crop: next } : k))
          : [...v.keys, { t, crop: next }].sort((a, b) => a.t - b.t);
      return { ...v, keys };
    }, "recorte");

  // loop de reprodução dentro da janela de corte
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      if (v.currentTime >= end - 0.03) {
        if (loop) v.currentTime = start;
        else if (!v.paused) v.pause();
      }
      setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, end, loop]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.min(Math.max(t, 0), Math.max(0, duration - 0.05));
      setTime(t);
    },
    [duration],
  );

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime > end) v.currentTime = start;
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [start, end]);

  const step = (frames: number) => seek(Math.min(end, Math.max(start, time + frames / 30)));

  const onPointerDown = useCallback(
    (e: React.PointerEvent, mode: Drag["mode"]) => {
      e.stopPropagation();
      const b = boxRef.current?.getBoundingClientRect();
      if (!b) return;
      dragRef.current = {
        mode,
        x: (e.clientX - b.left) / b.width,
        y: (e.clientY - b.top) / b.height,
        crop: { ...crop },
        t: videoRef.current?.currentTime ?? time,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [crop, time],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      const b = boxRef.current?.getBoundingClientRect();
      if (!d || !b) return;
      const nx = (e.clientX - b.left) / b.width;
      const ny = (e.clientY - b.top) / b.height;
      const dx = nx - d.x;
      const dy = ny - d.y;
      const c = d.crop;
      const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
      const MIN = 0.06;
      const next = { ...c };
      if (d.mode === "move") {
        next.x = clamp(c.x + dx, 0, 1 - c.w);
        next.y = clamp(c.y + dy, 0, 1 - c.h);
      } else {
        const m = d.mode;
        const right = c.x + c.w;
        const bottom = c.y + c.h;
        if (m.includes("w")) {
          const x = clamp(c.x + dx, 0, right - MIN);
          next.x = x;
          next.w = right - x;
        } else if (m.includes("e")) {
          next.w = clamp(c.w + dx, MIN, 1 - c.x);
        }
        if (m.startsWith("n")) {
          const y = clamp(c.y + dy, 0, bottom - MIN);
          next.y = y;
          next.h = bottom - y;
        } else if (m.startsWith("s")) {
          next.h = clamp(c.h + dy, MIN, 1 - c.y);
        }
        // mantém a proporção escolhida (9:16, 1:1, …) enquanto redimensiona
        if (lock && width && height) {
          const boxAR = width / height;
          const hFromW = (next.w * boxAR) / lock;
          const wFromH = (next.h * lock) / boxAR;
          const drivenByWidth = m.includes("w") || m.includes("e");
          if (drivenByWidth) {
            next.h = Math.min(hFromW, 1);
            next.w = (next.h * lock) / boxAR;
          } else {
            next.w = Math.min(wFromH, 1);
            next.h = (next.w * boxAR) / lock;
          }
          if (m.startsWith("n")) next.y = clamp(bottom - next.h, 0, 1 - next.h);
          if (m.includes("w")) next.x = clamp(right - next.w, 0, 1 - next.w);
          next.x = clamp(next.x, 0, 1 - next.w);
          next.y = clamp(next.y, 0, 1 - next.h);
        }
      }
      // sem keyframes = recorte fixo; com keyframes o arraste grava/edita o ponto do instante atual
      setPre((v) => {
        if (v.keys.length === 0) return { ...v, crop: next };
        const t = Number(d.t.toFixed(2));
        const i = v.keys.findIndex((k) => Math.abs(k.t - t) <= 0.2);
        const keys =
          i >= 0
            ? v.keys.map((k, j) => (j === i ? { t: k.t, crop: next } : k))
            : [...v.keys, { t, crop: next }].sort((a, b) => a.t - b.t);
        return { ...v, keys };
      }, "recorte");
    },
    [lock, width, height, setPre],
  );

  /** aplica uma proporção (ou libera) centralizando o recorte */
  const applyRatio = (ratio: number | null) => {
    setLock(ratio);
    setPre((v) => ({ ...v, crop: ratio ? cropForRatio(ratio, width || 1080, height || 1920) : null }), "proporção");
  };

  const centerCrop = () =>
    setPre((v) => {
      const c = v.crop ?? { x: 0, y: 0, w: 1, h: 1 };
      return { ...v, crop: { ...c, x: (1 - c.w) / 2, y: (1 - c.h) / 2 } };
    }, "centralizar");

  /** grava o recorte atual como keyframe no instante do playhead */
  const addKey = useCallback(
    () =>
      setPre((v) => {
        const c = cropAt(v, time) ?? v.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const t = Number(time.toFixed(2));
        const key: FrameKey = { t, crop: { ...c } };
        const keys = [...v.keys.filter((k) => Math.abs(k.t - t) > 0.05), key].sort((a, b) => a.t - b.t);
        return { ...v, keys };
      }, "keyframe"),
    [setPre, time],
  );

  /** trechos mantidos na sequência final */
  const segs = keptSegments(pre, { start, end }, duration);
  const outDur = segmentsDuration(segs);

  /** divide o trecho no playhead (tesoura) */
  const split = useCallback(
    () =>
      setPre((v) => {
        const base = keptSegments(v, { start, end }, duration);
        const next = splitAt(base, Number(time.toFixed(2)));
        if (next.length === base.length) {
          toast.info("Leve o playhead para dentro de um trecho para dividir.");
          return v;
        }
        return { ...v, segments: next };
      }, "dividir"),
    [setPre, start, end, duration, time],
  );

  const deleteSegment = (i: number) =>
    setPre((v) => {
      const base = keptSegments(v, { start, end }, duration);
      if (base.length < 2) {
        toast.info("Divida o vídeo antes de remover um trecho.");
        return v;
      }
      const next = base.filter((_, idx) => idx !== i);
      const gone = base[i];
      if (gone && time >= gone.start && time <= gone.end) {
        const target = next[Math.min(i, next.length - 1)];
        if (target) seek(target.start);
      }
      return { ...v, segments: next };
    }, "remover trecho");

  /** remove as pausas automaticamente analisando o áudio */
  const cutSilence = async () => {
    setCutting(true);
    try {
      const { segments, removed } = await detectSpeechSegments(file, {
        sensitivity: sens,
        minSilence: minSil,
        window: { start, end },
      });
      if (!segments.length) {
        toast.error("Não achei fala suficiente — baixe a sensibilidade.");
        return;
      }
      setPre((v) => ({ ...v, segments }), "cortar pausas");
      const first = segments[0];
      if (first && (time < first.start || time > (segments[segments.length - 1]?.end ?? 0))) seek(first.start);
      toast.success(`${segments.length} trechos com fala · ${removed.toFixed(1)}s de silêncio removidos`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar o áudio.");
    } finally {
      setCutting(false);
    }
  };

  const separateAudioTracks = async () => {
    setSeparating(true);
    try {
      // Aqui chamaremos a função server-side ou worker quando integrada
      toast.promise(
        new Promise((resolve) => setTimeout(resolve, 2000)),
        {
          loading: "Analisando frequências e separando trilhas...",
          success: "Áudio separado com sucesso! (Modo Simulação)",
          error: "Erro ao processar áudio.",
        }
      );
    } finally {
      setSeparating(false);
    }
  };


  /** traduz a legenda mantendo os tempos por palavra */
  const translate = async () => {
    if (!captions?.length || !onCaptionsChange) return;
    setTranslating(true);
    try {
      const words = captions.flatMap((c) => c.words.map((w) => w.text));
      const { words: out } = await translateWords({ data: { words, language: lang } });
      let i = 0;
      const next: CaptionCue[] = captions.map((c) => ({
        ...c,
        words: c.words.map((w) => ({ ...w, text: out[i++] ?? w.text })),
      }));
      onCaptionsChange(next);
      toast.success(`Legenda traduzida para ${lang}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível traduzir a legenda.");
    } finally {
      setTranslating(false);
    }
  };

  const undo = useCallback(() => {
    const label = hist.undo();
    if (label) toast(`Desfeito: ${label}`);
  }, [hist]);
  const redo = useCallback(() => {
    const label = hist.redo();
    if (label) toast(`Refeito: ${label}`);
  }, [hist]);

  // atalhos de teclado estilo NLE
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el?.isContentEditable) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      switch (e.key) {
        case " ":
          e.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(Math.max(start, time - (e.shiftKey ? 1 : 1 / 30)));
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(Math.min(end, time + (e.shiftKey ? 1 : 1 / 30)));
          break;
        case "i":
        case "I":
          setStart(Math.min(time, end - 0.3));
          break;
        case "o":
        case "O":
          setEnd(Math.max(time, start + 0.3));
          break;
        case "s":
        case "S":
          split();
          break;
        case "k":
        case "K":
          addKey();
          break;
        case "Escape":
          onClose();
          break;
        default:
          if (/^[1-9]$/.test(e.key)) {
            const t = TOOL_ORDER[Number(e.key) - 1];
            if (t) setTab(t);
          }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, seek, time, start, end, split, addKey, undo, redo, onClose, setStart, setEnd]);

  const cropPx = {
    w: Math.round((crop.w || 1) * (width || 0)),
    h: Math.round((crop.h || 1) * (height || 0)),
  };

  const filter = preEditFilter(pre);
  const srcAR = width && height ? width / height : 9 / 16;
  const quarter = ((pre.rotate / 90) | 0) % 4;

  const clipWindow = useMemo(() => ({ start, end }), [start, end]);

  const save = () =>
    onSave({
      pre,
      clip: start > 0.02 || end < duration - 0.02 ? { start, end } : null,
    });

  const toolLabel = TOOL_ORDER.includes(tab)
    ? TOOL_GROUPS.flatMap((g) => g.items).find((i) => i.id === tab)?.label
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/95 p-1 sm:p-3">
      <div className="flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* barra superior */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h2 className="truncate font-display text-sm text-foreground">Estúdio de edição</h2>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {file.name} · {width}×{height} · {fmt(duration)} · saída {fmt(Math.max(0, outDur))}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" disabled={!hist.canUndo} onClick={undo} aria-label="Desfazer">
              <Undo2 className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" disabled={!hist.canRedo} onClick={redo} aria-label="Refazer">
              <Redo2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => hist.reset({ pre: defaultPreEdit(), start: 0, end: duration }, "resetar tudo")}
            >
              <RotateCcw className="mr-1 size-3.5" /> Resetar
            </Button>
            <Button size="sm" onClick={save}>
              Aplicar edição
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {/* corpo: trilha · palco · inspetor */}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[160px_minmax(0,1fr)_340px] md:overflow-hidden bg-background">
          {/* trilha de ferramentas estilo CapCut */}
          <aside className="flex gap-1 overflow-x-auto border-b border-border bg-surface p-2 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
            {TOOL_GROUPS.map((g) => (
              <div key={g.group} className="flex shrink-0 gap-1 md:block md:space-y-1">
                <span className="mb-1 hidden px-2 font-display text-[10px] font-bold uppercase tracking-wider text-muted-foreground md:block">
                  {g.group}
                </span>
                {g.items.map((t) => (
                  <TooltipProvider key={t.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setTab(t.id)}
                          className={cn(
                            "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-200",
                            tab === t.id
                              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                              : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                          )}
                        >
                          <t.icon className={cn("size-4 shrink-0 transition-transform group-hover:scale-110", tab === t.id ? "animate-pulse" : "")} />
                          <span className="font-display text-xs font-medium">{t.label}</span>
                          {tab === t.id && (
                            <div className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-white md:block hidden" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="bg-popover text-popover-foreground">
                        <p>{t.label} ({t.shortcut})</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
                <Separator className="my-2 hidden opacity-20 md:block" />
              </div>
            ))}
          </aside>

          {/* palco */}
          <section className="flex min-h-0 flex-col gap-2 p-3 md:overflow-hidden">
            {tab === "camera" ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <FramingStudio
                  url={url}
                  file={file}
                  width={width}
                  height={height}
                  duration={duration}
                  pre={pre}
                  onChange={(p) => setPre(p, "câmera")}
                />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex rounded-md border border-border p-0.5">
                    {(
                      [
                        ["out", "Saída 9:16"],
                        ["src", "Fonte"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setView(id)}
                        className={`rounded px-2 py-1 font-mono text-[11px] transition ${
                          view === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <ToggleChip on={thirds} onClick={() => setThirds((v) => !v)} icon={Grid3X3} label="Terços" />
                  <ToggleChip on={safe} onClick={() => setSafe((v) => !v)} icon={Shield} label="Área segura" />
                  <button
                    onMouseDown={() => setCompare(true)}
                    onMouseUp={() => setCompare(false)}
                    onMouseLeave={() => setCompare(false)}
                    onTouchStart={() => setCompare(true)}
                    onTouchEnd={() => setCompare(false)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition hover:text-foreground"
                  >
                    <Eye className="size-3.5" /> Comparar
                  </button>
                </div>

                <div className="relative flex min-h-0 flex-1 items-center justify-center">
                  {/* fonte (sempre montada: alimenta o canvas de saída) */}
                  <div
                    ref={boxRef}
                    className={`relative overflow-hidden rounded-xl border border-border bg-black ${
                      view === "out" ? "pointer-events-none invisible absolute size-px opacity-0" : "h-full max-h-full"
                    }`}
                    style={view === "out" ? undefined : { aspectRatio: String(srcAR), maxWidth: "100%" }}
                    onPointerMove={onPointerMove}
                    onPointerUp={() => (dragRef.current = null)}
                    onPointerCancel={() => (dragRef.current = null)}
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
                      onPause={() => setPlaying(false)}
                    />
                    {view === "src" && (
                      <div
                        className="absolute cursor-move border-2 border-primary"
                        style={{
                          left: `${crop.x * 100}%`,
                          top: `${crop.y * 100}%`,
                          width: `${crop.w * 100}%`,
                          height: `${crop.h * 100}%`,
                          boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
                        }}
                        onPointerDown={(e) => onPointerDown(e, "move")}
                      >
                        <div className="pointer-events-none absolute inset-0 opacity-60">
                          <div className="absolute inset-y-0 left-1/3 w-px bg-primary/40" />
                          <div className="absolute inset-y-0 left-2/3 w-px bg-primary/40" />
                          <div className="absolute inset-x-0 top-1/3 h-px bg-primary/40" />
                          <div className="absolute inset-x-0 top-2/3 h-px bg-primary/40" />
                        </div>
                        <span className="pointer-events-none absolute -top-6 left-0 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                          {cropPx.w}×{cropPx.h}
                          {pre.keys.length > 0
                            ? ` · ${nearKey ? `ajustando ${fmt(nearKey.t)}` : `nova posição em ${fmt(time)}`}`
                            : ""}
                        </span>
                        {HANDLES.map((h) => {
                          const cursor =
                            h === "n" || h === "s"
                              ? "cursor-ns-resize"
                              : h === "e" || h === "w"
                                ? "cursor-ew-resize"
                                : h === "nw" || h === "se"
                                  ? "cursor-nwse-resize"
                                  : "cursor-nesw-resize";
                          const mid = h.length === 1;
                          return (
                            <span
                              key={h}
                              onPointerDown={(e) => onPointerDown(e, h)}
                              className={`absolute size-3.5 rounded-sm border border-primary bg-background ${cursor}`}
                              style={{
                                left: h.includes("w")
                                  ? -7
                                  : mid && (h === "n" || h === "s")
                                    ? "calc(50% - 7px)"
                                    : undefined,
                                right: h.includes("e") ? -7 : undefined,
                                top: h.startsWith("n")
                                  ? -7
                                  : mid && (h === "e" || h === "w")
                                    ? "calc(50% - 7px)"
                                    : undefined,
                                bottom: h.startsWith("s") ? -7 : undefined,
                              }}
                            />
                          );
                        })}
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
                    />
                  )}
                </div>

                {/* transporte */}
                <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-border px-2 py-1.5">
                  <Button variant="ghost" size="icon" onClick={() => seek(start)} aria-label="Início">
                    <ChevronFirst className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => step(-1)} aria-label="Quadro anterior">
                    <StepBack className="size-4" />
                  </Button>
                  <Button size="icon" onClick={toggle} aria-label={playing ? "Pausar" : "Reproduzir"}>
                    {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => step(1)} aria-label="Próximo quadro">
                    <StepForward className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => seek(Math.max(start, end - 0.1))} aria-label="Fim">
                    <ChevronLast className="size-4" />
                  </Button>
                  <span className="px-1 font-mono text-[11px] text-foreground">
                    {fmt(time)} <span className="text-muted-foreground">/ {fmt(end)}</span>
                  </span>
                  <select
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                    aria-label="Velocidade"
                    className="rounded-md border border-border bg-background px-1.5 py-1 font-mono text-[11px] text-foreground"
                  >
                    {SPEEDS.map((s) => (
                      <option key={s} value={s}>
                        {s}x
                      </option>
                    ))}
                  </select>
                  <ToggleChip on={loop} onClick={() => setLoop((v) => !v)} icon={Repeat} label="Loop" />
                </div>
              </>
            )}

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
              onSeek={seek}
              onTogglePlay={toggle}
              onTrim={(s, e) => hist.set((d) => ({ ...d, start: s, end: e }), "corte")}
              onKeysChange={(keys) => set({ keys }, "keyframes")}
              onAddKey={addKey}
              segments={segs}
              onSplit={split}
              onDeleteSegment={deleteSegment}
            />
          </section>

          <aside
            className={cn(
              "flex flex-col border-t border-border bg-surface/50 p-0 md:border-l md:border-t-0 md:overflow-hidden",
              tab === "camera" ? "hidden md:flex" : "flex"
            )}
          >
            <div className="flex items-center justify-between border-b border-border p-4 bg-surface/80 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-tighter opacity-70">
                  Ajustes
                </Badge>
                <h3 className="font-display text-sm font-bold tracking-tight text-foreground">{toolLabel}</h3>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => hist.undo()} disabled={!hist.canUndo}>
                  <Undo2 className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8 rounded-full" onClick={() => hist.redo()} disabled={!hist.canRedo}>
                  <Redo2 className="size-4" />
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1">
              <div className="space-y-6 p-4">

                {tab === "camera" && (
                  <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-12 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                      <Sparkles className="size-6 text-primary" />
                    </div>
                    <div className="max-w-[200px] space-y-1">
                      <p className="font-display text-sm font-bold">IA Motion Ativa</p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        O enquadramento está sendo controlado pela câmera virtual. Use o palco ao lado para ajustes manuais.
                      </p>
                    </div>
                  </div>
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
                  <Button variant="secondary" size="sm" onClick={() => setStart(Math.min(time, end - 0.3))}>
                    Início aqui (I)
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEnd(Math.max(start + 0.3, time))}>
                    Fim aqui (O)
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => hist.set((d) => ({ ...d, start: 0, end: duration }), "vídeo inteiro")}
                  >
                    Vídeo inteiro
                  </Button>
                </div>
                <div className="space-y-2 rounded-lg border border-border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={split}>
                      <Scissors className="mr-1 size-3.5" /> Dividir aqui (S)
                    </Button>
                    {pre.segments.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => set({ segments: [] }, "juntar trechos")}>
                        Juntar tudo
                      </Button>
                    )}
                  </div>
                  {segs.length > 1 ? (
                    <ul className="space-y-1">
                      {segs.map((s, i) => (
                        <li
                          key={`${i}-${s.start}`}
                          className="flex items-center justify-between rounded-md border border-border px-2 py-1 font-mono text-[11px]"
                        >
                          <button className="text-primary" onClick={() => seek(s.start)}>
                            {i + 1}. {fmt(s.start)} → {fmt(s.end)}
                          </button>
                          <span className="text-muted-foreground">{fmt(s.end - s.start)}</span>
                          <button className="text-destructive" onClick={() => deleteSegment(i)}>
                            remover
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      Divida o vídeo para remover partes do meio e exportar só os trechos bons.
                    </p>
                  )}
                </div>

                <div className="space-y-2 rounded-lg border border-border p-2">
                  <p className="font-mono text-[11px] text-foreground">Remover silêncio automaticamente</p>
                  <Field label={`Sensibilidade · ${Math.round(sens * 100)}%`}>
                    <Slider value={[sens]} min={0.1} max={0.95} step={0.05} onValueChange={([v]) => setSens(v ?? 0.5)} />
                  </Field>
                  <Field label={`Pausa mínima · ${minSil.toFixed(2)}s`}>
                    <Slider
                      value={[minSil]}
                      min={0.15}
                      max={1.5}
                      step={0.05}
                      onValueChange={([v]) => setMinSil(v ?? 0.35)}
                    />
                  </Field>
                  <Button size="sm" variant="secondary" disabled={cutting} onClick={cutSilence}>
                    <AudioLines className="mr-1 size-3.5" />
                    {cutting ? "Analisando áudio…" : "Cortar pausas"}
                  </Button>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    Analisa o áudio e mantém só os trechos com fala — os trechos ficam editáveis na timeline.
                  </p>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  Duração final: {fmt(Math.max(0, outDur))}
                  {segs.length > 1 ? ` · ${segs.length} trechos` : ""}
                </p>
              </div>
            )}

            {tab === "layout" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => set({ layout: l.id as LayoutKind }, "layout")}
                      className={`flex gap-2 rounded-lg border p-2 text-left transition ${
                        (pre.layout ?? "auto") === l.id
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <LayoutGlyph id={l.id} />
                      <span className="min-w-0">
                        <span className="block font-mono text-[11px] text-foreground">{l.label}</span>
                        <span className="block font-mono text-[10px] text-muted-foreground">{l.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {["blur", "spotlight", "centered"].includes(pre.layout ?? "auto") && (
                  <div className="space-y-3 rounded-lg border border-border p-3">
                    <div className="flex gap-1.5">
                      {(["blur", "color"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => set({ bgMode: m }, "fundo")}
                          className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[11px] transition ${
                            (pre.bgMode ?? "blur") === m
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {m === "blur" ? "Fundo desfocado" : "Cor fixa"}
                        </button>
                      ))}
                    </div>
                    {(pre.bgMode ?? "blur") === "blur" ? (
                      <div className="space-y-1">
                        <p className="font-mono text-[10px] text-muted-foreground">
                          Intensidade do desfoque · {Math.round((pre.bgBlur ?? 1) * 100)}%
                        </p>
                        <Slider
                          value={[pre.bgBlur ?? 1]}
                          min={0}
                          max={2}
                          step={0.05}
                          onValueChange={([v]) => set({ bgBlur: v ?? 1 }, "desfoque do fundo")}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={pre.bgColor ?? "#000000"}
                          onChange={(e) => set({ bgColor: e.target.value }, "cor do fundo")}
                          className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
                          aria-label="Cor do fundo"
                        />
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {(pre.bgColor ?? "#000000").toUpperCase()}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <p className="font-mono text-[11px] text-muted-foreground">
                  O palco já mostra a saída real 9:16 — o mesmo desenho usado na exportação.
                </p>
              </div>
            )}

            {tab === "crop" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {CROP_PRESETS.map((p) => {
                    const active = p.ratio === null ? lock === null && isFullCrop(pre.crop) : lock === p.ratio;
                    return (
                      <button
                        key={p.id}
                        onClick={() => applyRatio(p.ratio ?? null)}
                        className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition ${
                          active
                            ? "border-primary text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  Use a visão <strong className="text-foreground">Fonte</strong> no palco para arrastar o
                  retângulo de recorte.
                  {lock ? " Proporção travada — o recorte mantém o formato." : ""}
                </p>
                <div className="rounded-lg border border-border p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      Posições de corte · {pre.keys.length}
                    </span>
                    <div className="flex gap-1.5">
                      <Button size="sm" onClick={addKey}>
                        {nearKey ? `Ajustar em ${fmt(time)}` : `Nova em ${fmt(time)}`}
                      </Button>
                      {pre.keys.length > 0 && (
                        <Button variant="secondary" size="sm" onClick={() => set({ keys: [] }, "limpar keyframes")}>
                          Limpar
                        </Button>
                      )}
                    </div>
                  </div>
                  {pre.keys.length === 0 ? (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      Sem posições — o recorte vale para o vídeo todo. Crie posições para a câmera acompanhar
                      quem está falando.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {[...pre.keys]
                        .sort((a, b) => a.t - b.t)
                        .map((k, i, arr) => {
                          const until = arr[i + 1]?.t ?? end;
                          const on = nearKey?.t === k.t;
                          return (
                            <li
                              key={k.t}
                              className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 font-mono text-[11px] ${
                                on ? "border-primary bg-primary/10" : "border-border"
                              }`}
                            >
                              <button className="text-primary" onClick={() => seek(k.t)}>
                                {fmt(k.t)} — {fmt(until)}
                              </button>
                              <span className="text-muted-foreground">
                                x {Math.round(k.crop.x * 100)}% · y {Math.round(k.crop.y * 100)}% ·{" "}
                                {(1 / Math.max(0.01, k.crop.w)).toFixed(2)}x
                              </span>
                              <button
                                className="text-destructive"
                                onClick={() => set({ keys: pre.keys.filter((x) => x.t !== k.t) }, "remover keyframe")}
                              >
                                remover
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={centerCrop}>
                    Centralizar
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => applyRatio(null)}>
                    Quadro inteiro
                  </Button>
                  <span className="self-center font-mono text-[11px] text-muted-foreground">
                    saída {cropPx.w}×{cropPx.h}px
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Num label="X %" value={crop.x} onChange={(n) => applyCrop({ ...crop, x: Math.min(n, 1 - crop.w) }, time)} />
                  <Num label="Y %" value={crop.y} onChange={(n) => applyCrop({ ...crop, y: Math.min(n, 1 - crop.h) }, time)} />
                  <Num
                    label="Larg. %"
                    value={crop.w}
                    onChange={(n) => applyCrop({ ...crop, w: Math.min(Math.max(n, 0.06), 1 - crop.x) }, time)}
                  />
                  <Num
                    label="Alt. %"
                    value={crop.h}
                    onChange={(n) => applyCrop({ ...crop, h: Math.min(Math.max(n, 0.06), 1 - crop.y) }, time)}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => set({ rotate: (((quarter + 1) % 4) * 90) as PreEdit["rotate"] }, "girar")}
                  >
                    <RotateCw className="mr-1 size-3.5" /> Girar 90°
                  </Button>
                  <Button
                    variant={pre.flipH ? "default" : "secondary"}
                    size="sm"
                    onClick={() => set({ flipH: !pre.flipH }, "espelhar")}
                  >
                    <FlipHorizontal className="mr-1 size-3.5" /> Espelhar
                  </Button>
                  <Button
                    variant={pre.flipV ? "default" : "secondary"}
                    size="sm"
                    onClick={() => set({ flipV: !pre.flipV }, "inverter")}
                  >
                    <FlipVertical className="mr-1 size-3.5" /> Inverter
                  </Button>
                </div>
              </div>
            )}

            {tab === "keys" && (
              <div className="space-y-4">
                <p className="font-mono text-[11px] text-muted-foreground">
                  Keyframes movem o enquadramento ao longo do vídeo: leve o playhead até o ponto, ajuste o
                  recorte na ferramenta “Enquadrar” e grave (tecla K).
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={addKey}>
                    Gravar keyframe em {fmt(time)}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => set({ keys: [] }, "limpar keyframes")}>
                    Limpar todos
                  </Button>
                </div>
                {pre.keys.length === 0 ? (
                  <p className="font-mono text-[11px] text-muted-foreground">Nenhum keyframe — enquadramento fixo.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {[...pre.keys]
                      .sort((a, b) => a.t - b.t)
                      .map((k) => (
                        <li
                          key={k.t}
                          className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 font-mono text-[11px]"
                        >
                          <button className="text-primary" onClick={() => seek(k.t)}>
                            {fmt(k.t)}
                          </button>
                          <span className="text-muted-foreground">
                            {Math.round(k.crop.w * 100)}% × {Math.round(k.crop.h * 100)}%
                          </span>
                          <button
                            className="text-destructive"
                            onClick={() => set({ keys: pre.keys.filter((x) => x.t !== k.t) }, "remover keyframe")}
                          >
                            remover
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            {tab === "trans" && (
              <div className="space-y-5">
                {(["transIn", "transOut"] as const).map((key) => (
                  <div key={key} className="space-y-2">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {key === "transIn" ? "Transição de abertura" : "Transição de saída"}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {TRANSITIONS.map((tr) => (
                        <button
                          key={tr.id}
                          onClick={() =>
                            set({ [key]: { ...pre[key], kind: tr.id as TransitionKind } } as Partial<PreEdit>, "transição")
                          }
                          className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition ${
                            pre[key].kind === tr.id
                              ? "border-primary text-primary"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {tr.label}
                        </button>
                      ))}
                    </div>
                    <Field label={`Duração · ${pre[key].dur.toFixed(2)}s`}>
                      <Slider
                        value={[pre[key].dur]}
                        min={0.1}
                        max={2}
                        step={0.05}
                        onValueChange={([v]) => set({ [key]: { ...pre[key], dur: v ?? 0.5 } } as Partial<PreEdit>, "transição")}
                      />
                    </Field>
                  </div>
                ))}
                <p className="font-mono text-[11px] text-muted-foreground">
                  As transições aparecem no palco e na exportação.
                </p>
              </div>
            )}

            {tab === "caps" && (
              <div className="space-y-3">
                {captions?.length ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                      <Languages className="size-3.5 text-primary" />
                      <select
                        value={lang}
                        onChange={(e) => setLang(e.target.value)}
                        className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground"
                      >
                        {LANGS.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="secondary" disabled={translating} onClick={() => void translate()}>
                        {translating ? "Traduzindo…" : "Traduzir legenda"}
                      </Button>
                    </div>
                    <CaptionTimeline file={file} cues={captions} onChange={(cues) => onCaptionsChange?.(cues)} />
                  </>
                ) : (
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Sem legenda ainda. Gere a transcrição no painel de legendas e volte aqui para corrigir
                    palavras e tempos.
                  </p>
                )}
              </div>
            )}

            {tab === "text" && (
              <div className="space-y-3">
                {texts ? (
                  <>
                    {(
                      [
                        ["headline", "Headline"],
                        ["name", "Nome"],
                        ["handle", "Arroba"],
                        ["cta", "CTA"],
                      ] as const
                    ).map(([k, label]) => (
                      <label key={k} className="block space-y-1">
                        <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
                        <input
                          value={draft[k]}
                          onChange={(e) => {
                            const next = { ...draft, [k]: e.target.value };
                            setDraft(next);
                            onTextsChange?.(next);
                          }}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
                        />
                      </label>
                    ))}
                    <p className="font-mono text-[11px] text-muted-foreground">
                      Os textos valem para este vídeo no preview e na exportação.
                    </p>
                  </>
                ) : (
                  <p className="font-mono text-[11px] text-muted-foreground">Textos indisponíveis neste modo.</p>
                )}
              </div>
            )}

              {tab === "audio" && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Separar Áudio e Música</h3>
                    <p className="text-xs text-muted-foreground">
                      Use nossa IA para isolar a voz da música de fundo automaticamente.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <Button
                      variant="outline"
                      className="h-auto flex-col items-start gap-1 py-4 text-left"
                      onClick={separateAudioTracks}
                      disabled={separating}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span>Separar com IA</span>
                      </div>
                      <span className="text-[10px] opacity-70">Detecta vozes e instrumentos de forma independente</span>
                    </Button>
                  </div>

                  <div className="space-y-4 pt-4 border-t">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Mixagem</h4>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Mic className="h-3 w-3 text-primary" />
                          <span>Voz / Diálogo</span>
                        </div>
                        <span className="font-mono">100%</span>
                      </div>
                      <Slider defaultValue={[100]} max={100} step={1} />
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Music className="h-3 w-3 text-blue-400" />
                          <span>Música de Fundo</span>
                        </div>
                        <span className="font-mono">100%</span>
                      </div>
                      <Slider defaultValue={[100]} max={100} step={1} />
                    </div>
                  </div>

                  <div className="rounded-lg bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    Dica: Reduza a música para destacar a fala em vídeos com muito ruído ambiente.
                  </div>
                </div>
              )}
              {tab === "color" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => set(p.v, "cor")}
                      className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <Field label={`Brilho · ${pre.brightness.toFixed(2)}`}>
                  <Slider
                    value={[pre.brightness]}
                    min={0.4}
                    max={1.8}
                    step={0.01}
                    onValueChange={([v]) => set({ brightness: v ?? 1 }, "cor")}
                  />
                </Field>
                <Field label={`Contraste · ${pre.contrast.toFixed(2)}`}>
                  <Slider
                    value={[pre.contrast]}
                    min={0.4}
                    max={2}
                    step={0.01}
                    onValueChange={([v]) => set({ contrast: v ?? 1 }, "cor")}
                  />
                </Field>
                <Field label={`Saturação · ${pre.saturation.toFixed(2)}`}>
                  <Slider
                    value={[pre.saturation]}
                    min={0}
                    max={2.5}
                    step={0.01}
                    onValueChange={([v]) => set({ saturation: v ?? 1 }, "cor")}
                  />
                </Field>
                <Field label={`Matiz · ${Math.round(pre.hue)}°`}>
                  <Slider value={[pre.hue]} min={-180} max={180} step={1} onValueChange={([v]) => set({ hue: v ?? 0 }, "cor")} />
                </Field>
                <Field label={`Sépia · ${Math.round(pre.sepia * 100)}%`}>
                  <Slider value={[pre.sepia]} min={0} max={1} step={0.01} onValueChange={([v]) => set({ sepia: v ?? 0 }, "cor")} />
                </Field>
                <Field label={`P&B · ${Math.round(pre.grayscale * 100)}%`}>
                  <Slider
                    value={[pre.grayscale]}
                    min={0}
                    max={1}
                    step={0.01}
                    onValueChange={([v]) => set({ grayscale: v ?? 0 }, "cor")}
                  />
                </Field>
                <Field label={`Desfoque · ${pre.blur.toFixed(1)}px`}>
                  <Slider value={[pre.blur]} min={0} max={8} step={0.1} onValueChange={([v]) => set({ blur: v ?? 0 }, "cor")} />
                </Field>
                </div>
              </div>
            </ScrollArea>


            <div className="border-t border-border p-4 bg-surface/80 backdrop-blur-sm">
              <p className="font-mono text-[10px] leading-relaxed text-muted-foreground opacity-60">
                Atalhos: <kbd className="rounded bg-muted px-1 text-foreground">espaço</kbd> play · 
                <kbd className="rounded bg-muted px-1 text-foreground">setas</kbd> quadro a quadro · 
                <kbd className="rounded bg-muted px-1 text-foreground">I</kbd>/<kbd className="rounded bg-muted px-1 text-foreground">O</kbd> entrada/saída · 
                <kbd className="rounded bg-muted px-1 text-foreground">S</kbd> dividir ·
                <kbd className="rounded bg-muted px-1 text-foreground">K</kbd> keyframe.
              </p>
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
  icon: typeof Grid3X3;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition ${
        on ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value))) / 100)}
        className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
      />
    </label>
  );
}
