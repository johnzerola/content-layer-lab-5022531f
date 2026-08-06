import { useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
};

/** Comparador antes/depois com divisória arrastável (estilo Vmake/Pollo). */
export function BeforeAfterSlider({
  before,
  after,
  beforeLabel = "Antes",
  afterLabel = "Depois",
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  const move = useCallback((clientX: number) => {
    const el = boxRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - b.left) / b.width) * 100)));
  }, []);

  return (
    <div
      ref={boxRef}
      className="relative select-none overflow-hidden rounded-xl border border-border"
      onPointerDown={(e) => {
        setDragging(true);
        move(e.clientX);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => dragging && move(e.clientX)}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <div className="pointer-events-none">{before}</div>

      <div
        className="pointer-events-none absolute inset-0"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
      >
        {after}
      </div>

      <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-background/80 px-2 py-0.5 font-mono text-[10px] text-foreground backdrop-blur">
        {beforeLabel}
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded-md bg-primary/90 px-2 py-0.5 font-mono text-[10px] text-primary-foreground backdrop-blur">
        {afterLabel}
      </span>

      <div
        className="absolute inset-y-0 w-0.5 cursor-ew-resize bg-primary"
        style={{ left: `${pos}%` }}
      >
        <div className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary bg-background shadow-lg">
          <ChevronLeft className="size-3 text-primary" />
          <ChevronRight className="size-3 text-primary" />
        </div>
      </div>
    </div>
  );
}
