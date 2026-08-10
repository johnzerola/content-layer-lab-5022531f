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
}: {
  pre: PreEdit;
  onChange: (next: PreEdit) => void;
  onReset?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);
  const preRef = useRef(pre);
  preRef.current = pre;

  const crop = () => preRef.current.crop ?? FULL;
  const apply = (c: PreCrop) => onChange({ ...preRef.current, crop: normalize(c) });

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

      <div className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-md border border-border bg-background/85 px-1.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
        {hint ?? `x ${(c.x * 100).toFixed(0)}% · y ${(c.y * 100).toFixed(0)}% · ${(1 / c.w).toFixed(2)}x`}
      </div>
    </div>
  );
}
