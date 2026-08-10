import { useEffect, useRef, useState } from "react";
import { Move, ZoomIn, ZoomOut, RotateCcw, Diamond, Trash2, Plus } from "lucide-react";
import { type PreCrop, type PreEdit, type FrameKey, cropAt } from "@/lib/preedit";


const FULL: PreCrop = { x: 0, y: 0, w: 1, h: 1 };
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Mantém o recorte dentro dos limites do vídeo original. */
function normalize(c: PreCrop): PreCrop {
  const w = Math.max(0.12, Math.min(1, c.w));
  const h = Math.max(0.12, Math.min(1, c.h));
  return { w, h, x: clamp01(Math.min(c.x, 1 - w)), y: clamp01(Math.min(c.y, 1 - h)) };
}

/** Zoom ancorado num ponto (0..1) do recorte atual. */
function zoomAt(c: PreCrop, k: number, ax = 0.5, ay = 0.5): PreCrop {
  const px = c.x + c.w * ax;
  const py = c.y + c.h * ay;
  const w = Math.max(0.12, Math.min(1, c.w * k));
  const h = Math.max(0.12, Math.min(1, c.h * k));
  return normalize({ x: px - w * ax, y: py - h * ay, w, h });
}

/**
 * Mini editor embutido na prévia: arraste para mover, roda/pinça para dar zoom
 * e corrija o enquadramento em tempo real antes de processar.
 */
export function PreviewCropOverlay({
  pre,
  onChange,
  onReset,
  videoRef,
}: {
  pre: PreEdit;
  onChange: (next: PreEdit) => void;
  onReset?: () => void;
  /** <video> da prévia, para gravar keyframes no tempo atual */
  videoRef?: { current: HTMLVideoElement | null };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const preRef = useRef(pre);
  preRef.current = pre;

  // acompanha o tempo do vídeo da prévia para posicionar os keyframes
  useEffect(() => {
    if (!videoRef) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        setTime(v.currentTime || 0);
        setDur(Number.isFinite(v.duration) ? v.duration : 0);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  const keys = pre.keys ?? [];
  const SNAP = 0.2;
  const nearIdx = keys.findIndex((k) => Math.abs(k.t - time) <= SNAP);

  const crop = () => cropAt(preRef.current, time) ?? preRef.current.crop ?? FULL;

  const apply = (c: PreCrop) => {
    const p = preRef.current;
    const next = normalize(c);
    const ks = p.keys ?? [];
    if (ks.length === 0) {
      onChange({ ...p, crop: next });
      return;
    }
    // com keyframes, o ajuste grava/atualiza o keyframe do instante atual
    const i = ks.findIndex((k) => Math.abs(k.t - time) <= SNAP);
    const merged: FrameKey[] =
      i >= 0
        ? ks.map((k, j) => (j === i ? { t: k.t, crop: next } : k))
        : [...ks, { t: Number(time.toFixed(2)), crop: next }].sort((a, b) => a.t - b.t);
    onChange({ ...p, keys: merged });
  };

  const addKey = () => {
    const p = preRef.current;
    const c = normalize(crop());
    const t = Number(time.toFixed(2));
    const ks = (p.keys ?? []).filter((k) => Math.abs(k.t - t) > SNAP);
    onChange({ ...p, keys: [...ks, { t, crop: c }].sort((a, b) => a.t - b.t) });
    flash(`keyframe em ${t.toFixed(1)}s`);
  };

  const delKey = (t: number) => {
    const p = preRef.current;
    onChange({ ...p, keys: (p.keys ?? []).filter((k) => k.t !== t) });
  };

  const seek = (t: number) => {
    const v = videoRef?.current;
    if (v) v.currentTime = t;
    setTime(t);
  };


  const flash = (msg: string) => {
    setHint(msg);
    window.clearTimeout((flash as unknown as { t?: number }).t);
    (flash as unknown as { t?: number }).t = window.setTimeout(() => setHint(null), 900);
  };

  // wheel precisa de listener não passivo para bloquear a rolagem da página
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const box = el.getBoundingClientRect();
      const ax = clamp01((e.clientX - box.left) / box.width);
      const ay = clamp01((e.clientY - box.top) / box.height);
      const c = crop();
      const next = zoomAt(c, Math.exp(dy * 0.0015), ax, ay);
      apply(next);
      flash(`zoom ${(1 / next.w).toFixed(2)}x`);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = ref.current!.getBoundingClientRect();
    const start = { mx: e.clientX, my: e.clientY, ...crop() };
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - start.mx) / box.width) * start.w;
      const dy = ((ev.clientY - start.my) / box.height) * start.h;
      apply({ ...start, x: start.x - dx, y: start.y - dy });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const step = (k: number) => {
    const next = zoomAt(crop(), k);
    apply(next);
    flash(`zoom ${(1 / next.w).toFixed(2)}x`);
  };

  const c = crop();

  return (
    <div ref={ref} onPointerDown={onPointerDown} className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing">
      {/* grade de terços para ajudar a centralizar o rosto */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        {[1, 2].map((i) => (
          <div key={`v${i}`} className="absolute top-0 bottom-0 w-px bg-primary/50" style={{ left: `${(i * 100) / 3}%` }} />
        ))}
        {[1, 2].map((i) => (
          <div key={`h${i}`} className="absolute right-0 left-0 h-px bg-primary/50" style={{ top: `${(i * 100) / 3}%` }} />
        ))}
        <div className="absolute inset-0 border-2 border-primary/60" />
      </div>

      <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md border border-primary/40 bg-background/85 px-1.5 py-1 font-mono text-[10px] text-primary backdrop-blur">
        <Move className="size-3" /> arraste · role p/ zoom
      </div>

      <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => step(1 / 1.12)}
          className="rounded-md border border-border bg-background/85 p-1 text-foreground backdrop-blur hover:border-primary"
          title="aproximar"
        >
          <ZoomIn className="size-3.5" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => step(1.12)}
          className="rounded-md border border-border bg-background/85 p-1 text-foreground backdrop-blur hover:border-primary"
          title="afastar"
        >
          <ZoomOut className="size-3.5" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => (onReset ? onReset() : apply(FULL))}
          className="rounded-md border border-border bg-background/85 p-1 text-foreground backdrop-blur hover:border-primary"
          title="restaurar enquadramento"
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>

      {/* linha do tempo de keyframes de enquadramento */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-1.5 bottom-9 left-1.5 rounded-md border border-border bg-background/85 px-1.5 py-1 backdrop-blur"
      >
        <div className="mb-1 flex items-center justify-between gap-1">
          <span className="font-mono text-[10px] text-muted-foreground">
            {time.toFixed(1)}s{dur ? ` / ${dur.toFixed(1)}s` : ""} · {keys.length} kf
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={addKey}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                nearIdx >= 0
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
              title="gravar enquadramento neste instante"
            >
              <Plus className="size-3" /> keyframe
            </button>
            {keys.length > 0 && (
              <button
                type="button"
                onClick={() => onChange({ ...pre, keys: [] })}
                className="rounded border border-border p-0.5 text-muted-foreground hover:border-destructive hover:text-destructive"
                title="apagar todos os keyframes"
              >
                <Trash2 className="size-3" />
              </button>
            )}
          </div>
        </div>
        <div className="relative h-4">
          <div className="absolute top-1.5 right-0 left-0 h-px bg-border" />
          {dur > 0 && (
            <div
              className="absolute top-0 h-4 w-px bg-primary"
              style={{ left: `${clamp01(time / dur) * 100}%` }}
            />
          )}
          {dur > 0 &&
            keys.map((k) => (
              <button
                key={k.t}
                type="button"
                onClick={() => seek(k.t)}
                onDoubleClick={() => delKey(k.t)}
                title={`${k.t.toFixed(2)}s · clique p/ ir · duplo clique p/ apagar`}
                className="absolute -translate-x-1/2 text-primary hover:text-destructive"
                style={{ left: `${clamp01(k.t / dur) * 100}%` }}
              >
                <Diamond className="size-3 fill-current" />
              </button>
            ))}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-md border border-border bg-background/85 px-1.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
        {hint ??
          (keys.length
            ? `kf ${nearIdx >= 0 ? "editando" : "novo"} · ${(1 / c.w).toFixed(2)}x`
            : `x ${(c.x * 100).toFixed(0)}% · y ${(c.y * 100).toFixed(0)}% · ${(1 / c.w).toFixed(2)}x`)}
      </div>

    </div>
  );
}
