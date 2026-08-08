import { useCallback, useEffect, useRef, useState } from "react";
import {
  Crop,
  FlipHorizontal,
  FlipVertical,
  Pause,
  Play,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  COLOR_PRESETS,
  CROP_PRESETS,
  cropForRatio,
  defaultPreEdit,
  isFullCrop,
  preEditFilter,
  type PreEdit,
} from "@/lib/preedit";

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
  onClose: () => void;
  onSave: (v: PreEditResult) => void;
};

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

type Handle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e";
type Drag = { mode: "move" | Handle; x: number; y: number; crop: NonNullable<PreEdit["crop"]> };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Estúdio de pré-edição: corte de tempo, recorte de quadro, giro e cor. */
export function VideoStudio({ file, width, height, duration, value, onClose, onSave }: Props) {
  const [pre, setPre] = useState<PreEdit>(value.pre ?? defaultPreEdit());
  const [start, setStart] = useState(value.clip?.start ?? 0);
  const [end, setEnd] = useState(value.clip?.end ?? duration);
  const [tab, setTab] = useState<"trim" | "crop" | "color">("trim");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(value.clip?.start ?? 0);
  /** proporção travada do recorte (largura/altura em pixels da fonte) */
  const [lock, setLock] = useState<number | null>(null);

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

  const crop = pre.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const set = (p: Partial<PreEdit>) => setPre((v) => ({ ...v, ...p }));

  // loop de reprodução dentro da janela de corte
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      if (v.currentTime >= end - 0.03) v.currentTime = start;
      setTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, end]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(t, 0), Math.max(0, duration - 0.05));
    setTime(t);
  };

  const toggle = () => {
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
  };

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
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [crop],
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
          // altura normalizada equivalente à proporção travada
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
      setPre((v) => ({ ...v, crop: next }));
    },
    [lock, width, height],
  );

  /** aplica uma proporção (ou libera) centralizando o recorte */
  const applyRatio = (ratio: number | null) => {
    setLock(ratio);
    setPre((v) => ({ ...v, crop: ratio ? cropForRatio(ratio, width || 1080, height || 1920) : null }));
  };

  const centerCrop = () =>
    setPre((v) => {
      const c = v.crop ?? { x: 0, y: 0, w: 1, h: 1 };
      return { ...v, crop: { ...c, x: (1 - c.w) / 2, y: (1 - c.h) / 2 } };
    });

  const cropPx = {
    w: Math.round((crop.w || 1) * (width || 0)),
    h: Math.round((crop.h || 1) * (height || 0)),
  };

  const filter = preEditFilter(pre);
  const srcAR = width && height ? width / height : 9 / 16;
  const quarter = ((pre.rotate / 90) | 0) % 4;

  const save = () =>
    onSave({
      pre,
      clip: start > 0.02 || end < duration - 0.02 ? { start, end } : null,
    });

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/95 p-2 sm:items-center sm:p-3">
      <div className="flex h-full max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="font-display text-base text-foreground">Estúdio de edição</h2>
            <p className="font-mono text-[11px] text-muted-foreground">
              {file.name} · {width}×{height} · {fmt(duration)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setPre(defaultPreEdit()); setStart(0); setEnd(duration); }}>
              <Undo2 className="mr-1 size-3.5" /> Resetar
            </Button>
            <Button size="sm" onClick={save}>Aplicar edição</Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[1.1fr_1fr] md:overflow-hidden">
          {/* palco */}
          <div className="flex min-h-0 flex-col gap-3 md:overflow-y-auto">
            <div
              ref={boxRef}
              className="relative mx-auto overflow-hidden rounded-xl border border-border bg-black"
              style={{ aspectRatio: String(srcAR), height: "46vh", maxWidth: "100%", width: "auto" }}
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
                  transform: `translateZ(0) rotate(${pre.rotate}deg) scaleX(${pre.flipH ? -1 : 1}) scaleY(${pre.flipV ? -1 : 1})`,
                }}
                onLoadedMetadata={() => seek(start)}
                onPause={() => setPlaying(false)}
              />
              {tab === "crop" && (
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
                  {/* guias de terços */}
                  <div className="pointer-events-none absolute inset-0 opacity-60">
                    <div className="absolute inset-y-0 left-1/3 w-px bg-primary/40" />
                    <div className="absolute inset-y-0 left-2/3 w-px bg-primary/40" />
                    <div className="absolute inset-x-0 top-1/3 h-px bg-primary/40" />
                    <div className="absolute inset-x-0 top-2/3 h-px bg-primary/40" />
                  </div>
                  <span className="pointer-events-none absolute -top-6 left-0 rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                    {cropPx.w}×{cropPx.h}
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
                          left: h.includes("w") ? -7 : mid && (h === "n" || h === "s") ? "calc(50% - 7px)" : undefined,
                          right: h.includes("e") ? -7 : undefined,
                          top: h.startsWith("n") ? -7 : mid && (h === "e" || h === "w") ? "calc(50% - 7px)" : undefined,
                          bottom: h.startsWith("s") ? -7 : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" size="icon" onClick={toggle} aria-label="Reproduzir">
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </Button>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, duration)}
                step={0.05}
                value={time}
                onChange={(e) => seek(Number(e.target.value))}
                className="h-1.5 flex-1 accent-primary"
              />
              <span className="w-24 text-right font-mono text-[11px] text-muted-foreground">
                {fmt(time)} / {fmt(duration)}
              </span>
            </div>
          </div>

          {/* controles */}
          <div className="min-h-0 space-y-4 md:overflow-y-auto md:pr-1">
            <div className="flex gap-1 rounded-lg border border-border p-1">
              {([
                { id: "trim", label: "Cortar", icon: Scissors },
                { id: "crop", label: "Enquadrar", icon: Crop },
                { id: "color", label: "Cor", icon: SlidersHorizontal },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[11px] transition ${
                    tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <t.icon className="size-3.5" /> {t.label}
                </button>
              ))}
            </div>

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
                  <Button variant="secondary" size="sm" onClick={() => setStart(time)}>
                    Início aqui
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEnd(Math.max(start + 0.3, time))}>
                    Fim aqui
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setStart(0); setEnd(duration); }}>
                    Vídeo inteiro
                  </Button>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  Duração final: {fmt(Math.max(0, end - start))}
                </p>
              </div>
            )}

            {tab === "crop" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {CROP_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() =>
                        set({ crop: p.ratio ? cropForRatio(p.ratio, width || 1080, height || 1920) : null })
                      }
                      className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition ${
                        (p.ratio === null && isFullCrop(pre.crop)) ? "border-primary text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  Arraste o retângulo no palco para escolher a área que fica no vídeo.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Num label="X %" value={crop.x} onChange={(n) => set({ crop: { ...crop, x: Math.min(n, 1 - crop.w) } })} />
                  <Num label="Y %" value={crop.y} onChange={(n) => set({ crop: { ...crop, y: Math.min(n, 1 - crop.h) } })} />
                  <Num label="Larg. %" value={crop.w} onChange={(n) => set({ crop: { ...crop, w: Math.min(Math.max(n, 0.06), 1 - crop.x) } })} />
                  <Num label="Alt. %" value={crop.h} onChange={(n) => set({ crop: { ...crop, h: Math.min(Math.max(n, 0.06), 1 - crop.y) } })} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => set({ rotate: (((quarter + 1) % 4) * 90) as PreEdit["rotate"] })}
                  >
                    <RotateCw className="mr-1 size-3.5" /> Girar 90°
                  </Button>
                  <Button variant={pre.flipH ? "default" : "secondary"} size="sm" onClick={() => set({ flipH: !pre.flipH })}>
                    <FlipHorizontal className="mr-1 size-3.5" /> Espelhar
                  </Button>
                  <Button variant={pre.flipV ? "default" : "secondary"} size="sm" onClick={() => set({ flipV: !pre.flipV })}>
                    <FlipVertical className="mr-1 size-3.5" /> Inverter
                  </Button>
                </div>
              </div>
            )}

            {tab === "color" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => set(p.v)}
                      className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <Field label={`Brilho · ${pre.brightness.toFixed(2)}`}>
                  <Slider value={[pre.brightness]} min={0.4} max={1.8} step={0.01} onValueChange={([v]) => set({ brightness: v ?? 1 })} />
                </Field>
                <Field label={`Contraste · ${pre.contrast.toFixed(2)}`}>
                  <Slider value={[pre.contrast]} min={0.4} max={2} step={0.01} onValueChange={([v]) => set({ contrast: v ?? 1 })} />
                </Field>
                <Field label={`Saturação · ${pre.saturation.toFixed(2)}`}>
                  <Slider value={[pre.saturation]} min={0} max={2.5} step={0.01} onValueChange={([v]) => set({ saturation: v ?? 1 })} />
                </Field>
                <Field label={`Matiz · ${Math.round(pre.hue)}°`}>
                  <Slider value={[pre.hue]} min={-180} max={180} step={1} onValueChange={([v]) => set({ hue: v ?? 0 })} />
                </Field>
                <Field label={`Sépia · ${Math.round(pre.sepia * 100)}%`}>
                  <Slider value={[pre.sepia]} min={0} max={1} step={0.01} onValueChange={([v]) => set({ sepia: v ?? 0 })} />
                </Field>
                <Field label={`P&B · ${Math.round(pre.grayscale * 100)}%`}>
                  <Slider value={[pre.grayscale]} min={0} max={1} step={0.01} onValueChange={([v]) => set({ grayscale: v ?? 0 })} />
                </Field>
                <Field label={`Desfoque · ${pre.blur.toFixed(1)}px`}>
                  <Slider value={[pre.blur]} min={0} max={8} step={0.1} onValueChange={([v]) => set({ blur: v ?? 0 })} />
                </Field>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
