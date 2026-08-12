import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  Crosshair,
  Diamond,
  Loader2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { LayoutPreview } from "@/components/LayoutPreview";
import { undoable } from "@/lib/undo";
import type { PreEdit, PreCrop } from "@/lib/preedit";
import {
  defaultFramingPlan,
  defaultSegment,
  defaultTarget,
  FRAMING_LAYOUTS,
  FRAMING_TRANSITIONS,
  hasFraming,
  normalizeCrop,
  SEGMENT_COLORS,
  segmentEnd,
  segmentIndexAt,
  sortSegments,
  targetCrop,
  verticalCrop,
  type FramingLayout,
  type FramingPlan,
  type FramingSegment,
  type FramingTarget,
  type FramingTransition,
  type Slot,
} from "@/lib/framing";
import { detectSpeakers, suggestSegments } from "@/lib/speakers";

const ASK_KEY = "vv.framing.skipAsk";
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

type Handle = "move" | "nw" | "ne" | "sw" | "se";
type Drag = { slot: Slot; mode: Handle; mx: number; my: number; base: FramingTarget };

export function FramingStudio({
  url,
  file,
  width,
  height,
  duration,
  pre,
  onChange,
}: {
  url: string;
  file: File;
  width: number;
  height: number;
  duration: number;
  pre: PreEdit;
  onChange: (p: PreEdit) => void;
}) {
  const plan: FramingPlan = pre.framing ?? defaultFramingPlan();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const planRef = useRef(plan);
  planRef.current = plan;

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState(0);
  const [slot, setSlot] = useState<Slot>("main");
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ t: number } | null>(null);
  const [skipAsk, setSkipAsk] = useState(false);

  const past = useRef<FramingPlan[]>([]);
  const future = useRef<FramingPlan[]>([]);

  useEffect(() => {
    setSkipAsk(typeof window !== "undefined" && localStorage.getItem(ASK_KEY) === "1");
  }, []);

  const push = useCallback(
    (next: FramingPlan, history = true) => {
      if (history) {
        past.current = [...past.current.slice(-40), planRef.current];
        future.current = [];
      }
      onChange({ ...pre, framing: next });
    },
    [onChange, pre],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current = [planRef.current, ...future.current].slice(0, 40);
    onChange({ ...pre, framing: prev });
  }, [onChange, pre]);

  const redo = useCallback(() => {
    const next = future.current.shift();
    if (!next) return;
    past.current = [...past.current, planRef.current];
    onChange({ ...pre, framing: next });
  }, [onChange, pre]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // relógio do player
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setTime(v.currentTime || 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const segs = plan.segments;
  const activeIdx = segmentIndexAt(plan, time);
  const current = segs[sel] ?? segs[activeIdx] ?? null;
  const curIdx = segs.indexOf(current as FramingSegment);

  const seek = (t: number) => {
    const v = videoRef.current;
    const c = Math.min(Math.max(0, t), Math.max(0, duration - 0.05));
    if (v) v.currentTime = c;
    setTime(c);
  };

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const enable = (segments?: FramingSegment[]) => {
    const list = segments ?? (segs.length ? segs : [defaultSegment(0, width, height, "single", plan.speakers[0] ?? null)]);
    push({ ...plan, enabled: true, segments: sortSegments(list) });
  };

  const updateSegment = (i: number, patch: Partial<FramingSegment>, history = true) => {
    const list = segs.map((s, j) => (j === i ? { ...s, ...patch } : s));
    push({ ...plan, enabled: true, segments: list }, history);
  };

  const updateTarget = (i: number, s: Slot, patch: Partial<FramingTarget>, history = true) => {
    const seg = segs[i];
    if (!seg) return;
    updateSegment(
      i,
      { targets: seg.targets.map((t) => (t.slot === s ? { ...t, ...patch } : t)) },
      history,
    );
  };

  const addSegmentAt = (t: number) => {
    const from = segs[segmentIndexAt(plan, t)];
    const seg: FramingSegment = from
      ? { ...from, id: `${Date.now().toString(36)}`, start: Number(t.toFixed(2)), targets: from.targets.map((x) => ({ ...x })) }
      : defaultSegment(t, width, height, "single", plan.speakers[0] ?? null);
    const list = sortSegments([...segs, seg]);
    push({ ...plan, enabled: true, segments: list });
    setSel(list.findIndex((s) => s.id === seg.id));
    toast.success(`Novo ponto de foco em ${fmt(t)}`);
  };

  const removeSegment = (i: number) => {
    const seg = segs[i];
    if (!seg) return;
    const before = plan;
    push({ ...plan, segments: segs.filter((_, j) => j !== i) });
    setSel(Math.max(0, i - 1));
    undoable("Ponto de enquadramento removido.", () => onChange({ ...pre, framing: before }));
  };

  const resetAll = () => {
    const before = plan;
    push({ ...plan, enabled: false, segments: [] });
    undoable("Enquadramento dinâmico limpo.", () => onChange({ ...pre, framing: before }));
  };

  const resetCurrent = () => {
    if (curIdx < 0 || !current) return;
    const sp = plan.speakers.find((s) => s.id === current.targets[0]?.speaker) ?? null;
    updateSegment(curIdx, { ...defaultSegment(current.start, width, height, current.layout, sp), id: current.id, start: current.start });
  };

  /** detecta pessoas e sugere os trechos automaticamente */
  const autoDetect = async () => {
    setBusy("Analisando o vídeo…");
    try {
      const det = await detectSpeakers(file, { onProgress: (p) => setBusy(`Analisando o vídeo… ${Math.round(p * 100)}%`) });
      if (!det.speakers.length) {
        toast.error("Nenhuma pessoa reconhecida. Crie os pontos manualmente.");
        return;
      }
      const suggestion = suggestSegments(det, duration, width, height);
      push({ enabled: true, speakers: det.speakers, segments: sortSegments(suggestion.length ? suggestion : [defaultSegment(0, width, height, "single", det.speakers[0]!)]) });
      setSel(0);
      toast.success(
        `${det.speakers.length} pessoa(s) · ${suggestion.length} trecho(s) sugeridos${det.source === "aproximada" ? " (detecção aproximada)" : ""}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar o vídeo.");
    } finally {
      setBusy(null);
    }
  };

  const focusSpeaker = (id: string) => {
    if (curIdx < 0) return;
    const sp = plan.speakers.find((s) => s.id === id);
    if (!sp) return;
    const ratio = slot === "main" ? 9 / 16 : 9 / 8;
    const c = verticalCrop(sp.box.x + sp.box.w / 2, sp.box.y + sp.box.h / 2, width, height, ratio, 1);
    updateTarget(curIdx, slot, { speaker: id, track: true, ...c, zoom: 1 });
  };

  // ---- arraste / redimensionamento das caixas ----
  const onStagePointerDown = (e: React.PointerEvent, s: Slot, mode: Handle) => {
    if (curIdx < 0 || !current) return;
    const base = current.targets.find((t) => t.slot === s);
    if (!base) return;
    e.stopPropagation();
    e.preventDefault();
    setSlot(s);
    dragRef.current = { slot: s, mode, mx: e.clientX, my: e.clientY, base: { ...base } };
    past.current = [...past.current.slice(-40), plan];
    future.current = [];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onStagePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const box = stageRef.current?.getBoundingClientRect();
    if (!d || !box || curIdx < 0) return;
    const dx = (e.clientX - d.mx) / box.width;
    const dy = (e.clientY - d.my) / box.height;
    const b = d.base;
    let next: PreCrop;
    if (d.mode === "move") {
      next = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
    } else {
      const west = d.mode.includes("w");
      const north = d.mode.startsWith("n");
      const x = west ? b.x + dx : b.x;
      const y = north ? b.y + dy : b.y;
      const w = west ? b.w - dx : b.w + dx;
      const h = north ? b.h - dy : b.h + dy;
      next = { x, y, w, h };
    }
    updateTarget(curIdx, d.slot, { ...normalizeCrop(next), track: false }, false);
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  // zoom com a roda (listener não passivo pra travar a rolagem da página)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      const p = planRef.current;
      const i = p.segments.findIndex((s) => s.id === current?.id);
      if (i < 0) return;
      ev.preventDefault();
      const dy = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 100 : 1);
      const tg = p.segments[i]!.targets.find((t) => t.slot === slot);
      if (!tg) return;
      const zoom = Math.max(1, Math.min(4, (tg.zoom || 1) * Math.exp(-dy * 0.0015)));
      onChange({
        ...pre,
        framing: {
          ...p,
          segments: p.segments.map((s, j) =>
            j === i ? { ...s, targets: s.targets.map((t) => (t.slot === slot ? { ...t, zoom } : t)) } : s,
          ),
        },
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [current?.id, slot, onChange, pre]);

  const setLayout = (l: FramingLayout) => {
    if (curIdx < 0 || !current) return;
    let targets = current.targets;
    if (l === "split") {
      const top = targets.find((t) => t.slot === "top") ?? { ...(targets[0] ?? defaultTarget("top", width, height)), slot: "top" as Slot };
      const bottom =
        targets.find((t) => t.slot === "bottom") ??
        defaultTarget("bottom", width, height, plan.speakers.find((s) => s.id !== top.speaker) ?? null);
      targets = [{ ...top, slot: "top" }, { ...bottom, slot: "bottom" }];
      setSlot("top");
    } else {
      const main = targets.find((t) => t.slot === "main") ?? targets[0] ?? defaultTarget("main", width, height);
      targets = [{ ...main, slot: "main" }];
      setSlot("main");
    }
    updateSegment(curIdx, { layout: l, targets });
  };

  const stageTargets = current?.targets ?? [];
  const previewPre = useMemo(() => ({ ...pre, framing: plan }), [pre, plan]);
  const segColor = (i: number) => SEGMENT_COLORS[i % SEGMENT_COLORS.length]!;
  const srcAR = width && height ? width / height : 16 / 9;

  const clickTimeline = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = clamp01((e.clientX - box.left) / box.width) * duration;
    seek(t);
    if (!plan.enabled || !segs.length) return;
    if (skipAsk) addSegmentAt(t);
    else setAsk({ t });
  };

  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[1.25fr_260px] md:overflow-hidden">
      {/* palco + timeline */}
      <div className="flex min-h-0 flex-col gap-3 md:overflow-y-auto">
        <div
          ref={stageRef}
          onPointerMove={onStagePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative mx-auto w-full overflow-hidden rounded-xl border border-border bg-black"
          style={{ aspectRatio: String(srcAR), maxHeight: "44vh" }}
        >
          <video
            ref={videoRef}
            src={url}
            playsInline
            muted
            preload="auto"
            className="absolute inset-0 size-full object-contain"
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
          />

          {/* pessoas detectadas: clique para focar */}
          {plan.speakers.map((sp) => (
            <button
              key={sp.id}
              type="button"
              onClick={() => focusSpeaker(sp.id)}
              title={`Focar ${sp.label}`}
              className="absolute rounded border-2 border-dashed text-[10px]"
              style={{
                left: `${sp.box.x * 100}%`,
                top: `${sp.box.y * 100}%`,
                width: `${sp.box.w * 100}%`,
                height: `${sp.box.h * 100}%`,
                borderColor: sp.color,
                color: sp.color,
              }}
            >
              <span
                className="absolute -top-4 left-0 rounded px-1 font-mono text-[10px] text-background"
                style={{ background: sp.color }}
              >
                {sp.label}
              </span>
            </button>
          ))}

          {/* caixas de enquadramento */}
          {plan.enabled &&
            stageTargets.map((tg) => {
              const c = targetCrop(plan, tg, time);
              const active = tg.slot === slot;
              return (
                <div
                  key={tg.slot}
                  onPointerDown={(e) => onStagePointerDown(e, tg.slot, "move")}
                  className={`absolute cursor-move border-2 ${active ? "border-primary" : "border-primary/40"}`}
                  style={{
                    left: `${c.x * 100}%`,
                    top: `${c.y * 100}%`,
                    width: `${c.w * 100}%`,
                    height: `${c.h * 100}%`,
                    boxShadow: active ? "0 0 0 9999px rgba(0,0,0,0.55)" : undefined,
                  }}
                >
                  <span className="pointer-events-none absolute -top-5 left-0 rounded bg-primary px-1 font-mono text-[10px] text-primary-foreground">
                    {tg.slot === "main" ? "Adjust" : tg.slot === "top" ? "Top" : "Bottom"}
                    {tg.track ? " · track" : ""}
                  </span>
                  <div className="pointer-events-none absolute inset-0 opacity-50">
                    <div className="absolute inset-y-0 left-1/3 w-px bg-primary/50" />
                    <div className="absolute inset-y-0 left-2/3 w-px bg-primary/50" />
                    <div className="absolute inset-x-0 top-1/3 h-px bg-primary/50" />
                    <div className="absolute inset-x-0 top-2/3 h-px bg-primary/50" />
                  </div>
                  {(["nw", "ne", "sw", "se"] as const).map((h) => (
                    <span
                      key={h}
                      onPointerDown={(e) => onStagePointerDown(e, tg.slot, h)}
                      className={`absolute size-3 rounded-sm border border-primary bg-background ${
                        h === "nw" || h === "se" ? "cursor-nwse-resize" : "cursor-nesw-resize"
                      }`}
                      style={{
                        left: h.includes("w") ? -6 : undefined,
                        right: h.includes("e") ? -6 : undefined,
                        top: h.startsWith("n") ? -6 : undefined,
                        bottom: h.startsWith("s") ? -6 : undefined,
                      }}
                    />
                  ))}
                </div>
              );
            })}

          {!plan.enabled && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/70">
              <Button size="sm" onClick={() => enable()}>
                <Camera className="mr-1 size-3.5" /> Ativar enquadramento dinâmico
              </Button>
            </div>
          )}
        </div>

        {/* controles do player */}
        <div className="flex items-center gap-2">
          <Button size="icon" variant="secondary" onClick={toggle} aria-label="play">
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmt(time)} / {fmt(duration)}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={undo} title="Desfazer (Ctrl+Z)">
              <Undo2 className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={redo} title="Refazer (Ctrl+Shift+Z)">
              <Redo2 className="size-4" />
            </Button>
          </span>
        </div>

        {/* timeline de enquadramento */}
        <div className="space-y-1 rounded-lg border border-border p-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] text-foreground">Timeline de enquadramento</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              clique para criar/ajustar um ponto · duplo clique no ◆ apaga
            </span>
          </div>
          <div
            onClick={clickTimeline}
            className="relative h-12 cursor-crosshair overflow-hidden rounded-md border border-border bg-muted/40"
          >
            {segs.map((s, i) => {
              const end = segmentEnd(plan, i, duration);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSel(i);
                    seek(s.start + 0.01);
                  }}
                  className={`absolute top-0 h-8 overflow-hidden border-r border-background/60 px-1 text-left font-mono text-[10px] ${
                    i === curIdx ? "ring-2 ring-inset ring-primary" : ""
                  }`}
                  style={{
                    left: `${(s.start / Math.max(0.1, duration)) * 100}%`,
                    width: `${((end - s.start) / Math.max(0.1, duration)) * 100}%`,
                    background: `${segColor(i)}33`,
                    color: segColor(i),
                  }}
                  title={`${fmt(s.start)} → ${fmt(end)} · ${s.layout}`}
                >
                  {s.layout}
                  {s.targets[0]?.speaker
                    ? ` · ${plan.speakers.find((p) => p.id === s.targets[0]!.speaker)?.label ?? s.targets[0]!.speaker}`
                    : ""}
                </button>
              );
            })}
            {segs.map((s, i) => (
              <button
                key={`k${s.id}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSel(i);
                  seek(s.start + 0.01);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  removeSegment(i);
                }}
                className="absolute bottom-0 -translate-x-1/2"
                style={{ left: `${(s.start / Math.max(0.1, duration)) * 100}%`, color: segColor(i) }}
                title={`${fmt(s.start)} · clique p/ selecionar · duplo clique p/ apagar`}
              >
                <Diamond className="size-3.5 fill-current" />
              </button>
            ))}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
              style={{ left: `${clamp01(time / Math.max(0.1, duration)) * 100}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" variant="secondary" onClick={() => addSegmentAt(time)}>
              <Diamond className="mr-1 size-3.5" /> Novo ponto aqui
            </Button>
            <Button size="sm" variant="ghost" onClick={resetCurrent} disabled={curIdx < 0}>
              <RotateCcw className="mr-1 size-3.5" /> Resetar trecho
            </Button>
            <Button size="sm" variant="ghost" onClick={resetAll} disabled={!segs.length}>
              <Trash2 className="mr-1 size-3.5" /> Resetar tudo
            </Button>
          </div>
        </div>
      </div>

      {/* inspetor + preview 9:16 */}
      <div className="min-h-0 space-y-3 md:overflow-y-auto md:pr-1">
        <div className="space-y-1">
          <LayoutPreview videoRef={videoRef} pre={previewPre} className="mx-auto h-52 w-auto rounded-lg border border-border bg-black" />
          <p className="text-center font-mono text-[10px] text-muted-foreground">
            preview 9:16 em tempo real — mesmo desenho da exportação
          </p>
        </div>

        <Button size="sm" className="w-full" variant="secondary" disabled={Boolean(busy)} onClick={autoDetect}>
          {busy ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Sparkles className="mr-1 size-3.5" />}
          {busy ?? "Auto Focus Speaker"}
        </Button>

        {plan.speakers.length > 0 && (
          <div className="space-y-1 rounded-lg border border-border p-2">
            <p className="flex items-center gap-1 font-mono text-[11px] text-foreground">
              <Users className="size-3.5" /> Quem aparece
            </p>
            <div className="flex flex-wrap gap-1">
              {plan.speakers.map((sp) => {
                const on = current?.targets.find((t) => t.slot === slot)?.speaker === sp.id;
                return (
                  <button
                    key={sp.id}
                    onClick={() => focusSpeaker(sp.id)}
                    className="rounded border px-1.5 py-0.5 font-mono text-[10px]"
                    style={{
                      borderColor: sp.color,
                      color: on ? "#0b0b0b" : sp.color,
                      background: on ? sp.color : "transparent",
                    }}
                  >
                    {sp.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {current && curIdx >= 0 ? (
          <div className="space-y-3 rounded-lg border border-border p-2">
            <p className="font-mono text-[11px] text-foreground">
              Trecho {curIdx + 1} · {fmt(current.start)} → {fmt(segmentEnd(plan, curIdx, duration))}
            </p>

            <div className="grid grid-cols-2 gap-1">
              {FRAMING_LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLayout(l.id)}
                  title={l.hint}
                  className={`rounded-md border px-2 py-1 font-mono text-[10px] transition ${
                    current.layout === l.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            {current.layout === "split" && (
              <div className="flex gap-1">
                {(["top", "bottom"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSlot(s)}
                    className={`flex-1 rounded-md border px-2 py-1 font-mono text-[10px] ${
                      slot === s ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"
                    }`}
                  >
                    {s === "top" ? "Top" : "Bottom"}
                  </button>
                ))}
              </div>
            )}

            {(() => {
              const tg = current.targets.find((t) => t.slot === slot) ?? current.targets[0];
              if (!tg) return null;
              return (
                <div className="space-y-2">
                  <label className="block font-mono text-[10px] text-muted-foreground">
                    Zoom · {(tg.zoom || 1).toFixed(2)}x
                    <Slider
                      value={[tg.zoom || 1]}
                      min={1}
                      max={4}
                      step={0.05}
                      onValueChange={([v]) => updateTarget(curIdx, tg.slot, { zoom: v ?? 1 }, false)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() =>
                        updateTarget(curIdx, tg.slot, {
                          ...verticalCrop(0.5, 0.5, width, height, tg.slot === "main" ? 9 / 16 : 9 / 8, 1),
                          speaker: null,
                          track: false,
                          zoom: 1,
                        })
                      }
                      className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary"
                    >
                      <Crosshair className="mr-1 inline size-3" /> Centralizar
                    </button>
                    <button
                      onClick={() => updateTarget(curIdx, tg.slot, { track: !tg.track })}
                      disabled={!tg.speaker}
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] disabled:opacity-40 ${
                        tg.track ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"
                      }`}
                    >
                      Seguir pessoa
                    </button>
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    x {(tg.x * 100).toFixed(0)}% · y {(tg.y * 100).toFixed(0)}% · w {(tg.w * 100).toFixed(0)}% · h{" "}
                    {(tg.h * 100).toFixed(0)}%
                  </p>
                </div>
              );
            })()}

            <div className="space-y-1">
              <p className="font-mono text-[10px] text-muted-foreground">Transição de entrada</p>
              <div className="grid grid-cols-4 gap-1">
                {FRAMING_TRANSITIONS.map((tr) => (
                  <button
                    key={tr.id}
                    title={tr.hint}
                    onClick={() => updateSegment(curIdx, { transition: tr.id as FramingTransition })}
                    className={`rounded-md border px-1 py-1 font-mono text-[10px] ${
                      current.transition === tr.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {tr.label}
                  </button>
                ))}
              </div>
              <label className="block font-mono text-[10px] text-muted-foreground">
                Duração · {(current.dur ?? 0).toFixed(2)}s
                <Slider
                  value={[current.dur ?? 0.35]}
                  min={0}
                  max={1.5}
                  step={0.05}
                  onValueChange={([v]) => updateSegment(curIdx, { dur: v ?? 0.35 }, false)}
                />
              </label>
            </div>

            <Button size="sm" variant="ghost" className="w-full" onClick={() => removeSegment(curIdx)}>
              <Trash2 className="mr-1 size-3.5" /> Excluir este ponto
            </Button>
          </div>
        ) : (
          <p className="rounded-lg border border-border p-2 font-mono text-[11px] text-muted-foreground">
            Ative o enquadramento dinâmico e clique na timeline para criar pontos de foco.
          </p>
        )}

        {hasFraming(plan) && (
          <p className="font-mono text-[10px] text-muted-foreground">
            {segs.length} ponto(s) · a exportação segue exatamente este preview.
          </p>
        )}
      </div>

      {/* diálogo novo ponto x ajustar atual */}
      {ask && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="font-display text-sm text-foreground">O que você quer fazer?</h3>
            <button
              onClick={() => {
                addSegmentAt(ask.t);
                setAsk(null);
              }}
              className="w-full rounded-lg border border-border p-2 text-left hover:border-primary"
            >
              <span className="block font-mono text-[11px] text-foreground">NEW POSITION</span>
              <span className="block font-mono text-[10px] text-muted-foreground">Criar um novo ponto de foco aqui</span>
            </button>
            <button
              onClick={() => {
                setSel(segmentIndexAt(plan, ask.t));
                setAsk(null);
              }}
              className="w-full rounded-lg border border-border p-2 text-left hover:border-primary"
            >
              <span className="block font-mono text-[11px] text-foreground">ADJUST CURRENT</span>
              <span className="block font-mono text-[10px] text-muted-foreground">Mover o enquadramento existente</span>
            </button>
            <label className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={skipAsk}
                onChange={(e) => {
                  setSkipAsk(e.target.checked);
                  localStorage.setItem(ASK_KEY, e.target.checked ? "1" : "0");
                }}
              />
              Don&apos;t show this again
            </label>
            <Button size="sm" variant="ghost" className="w-full" onClick={() => setAsk(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
