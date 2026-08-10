import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Diamond, Pause, Play, SkipBack, SkipForward, ZoomIn, ZoomOut } from "lucide-react";
import type { FrameKey, Transition } from "@/lib/preedit";
import type { CaptionCue } from "@/lib/captions";

interface Props {
  /** url do objeto do vídeo (para gerar as miniaturas) */
  url: string;
  duration: number;
  /** tempo atual do playhead */
  time: number;
  playing: boolean;
  /** janela de corte */
  start: number;
  end: number;
  keys: FrameKey[];
  transIn: Transition;
  transOut: Transition;
  cues?: CaptionCue[] | undefined;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onTrim: (start: number, end: number) => void;
  onKeysChange: (keys: FrameKey[]) => void;
  /** grava um keyframe no tempo atual usando o recorte corrente */
  onAddKey: () => void;
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.max(0, s - m * 60);
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
};

const THUMBS = 24;

/** Timeline de edição: filmstrip, corte, playhead, keyframes e legendas. */
export function EditorTimeline({
  url,
  duration,
  time,
  playing,
  start,
  end,
  keys,
  transIn,
  transOut,
  cues,
  onSeek,
  onTogglePlay,
  onTrim,
  onKeysChange,
  onAddKey,
}: Props) {
  const [pps, setPps] = useState(60);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<
    | { kind: "scrub" }
    | { kind: "in" | "out" }
    | { kind: "range"; x: number; s: number; e: number }
    | { kind: "key"; t: number; x: number }
    | null
  >(null);

  const total = Math.max(0.5, duration);
  const width = Math.max(240, total * pps);

  /** miniaturas do vídeo (geradas uma vez por arquivo) */
  useEffect(() => {
    if (!url || !duration) return;
    let cancelled = false;
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const canvas = document.createElement("canvas");

    const grab = (t: number) =>
      new Promise<string | null>((resolve) => {
        const done = () => {
          v.removeEventListener("seeked", done);
          const w = v.videoWidth || 160;
          const h = v.videoHeight || 90;
          const scale = 64 / h;
          canvas.width = Math.max(24, Math.round(w * scale));
          canvas.height = 64;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(null);
          try {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.6));
          } catch {
            resolve(null);
          }
        };
        v.addEventListener("seeked", done, { once: true });
        v.currentTime = Math.min(Math.max(t, 0), Math.max(0, duration - 0.05));
        setTimeout(() => resolve(null), 2500);
      });

    const run = async () => {
      await new Promise<void>((r) => {
        if (v.readyState >= 1) return r();
        v.addEventListener("loadedmetadata", () => r(), { once: true });
        setTimeout(() => r(), 4000);
      });
      const out: string[] = [];
      for (let i = 0; i < THUMBS; i++) {
        if (cancelled) return;
        const t = (duration * (i + 0.5)) / THUMBS;
        const img = await grab(t);
        out.push(img ?? "");
        if (i % 4 === 3 && !cancelled) setThumbs([...out]);
      }
      if (!cancelled) setThumbs(out);
    };
    void run();
    return () => {
      cancelled = true;
      v.src = "";
    };
  }, [url, duration]);

  const timeAt = useCallback(
    (clientX: number) => {
      const box = trackRef.current?.getBoundingClientRect();
      if (!box) return 0;
      return Math.min(total, Math.max(0, (clientX - box.left) / pps));
    },
    [pps, total],
  );

  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const t = timeAt(ev.clientX);
      if (d.kind === "scrub") onSeek(t);
      else if (d.kind === "in") onTrim(Math.min(t, end - 0.3), end);
      else if (d.kind === "out") onTrim(start, Math.max(t, start + 0.3));
      else if (d.kind === "range") {
        const box = trackRef.current?.getBoundingClientRect();
        if (!box) return;
        const dx = (ev.clientX - d.x) / pps;
        const len = d.e - d.s;
        const s = Math.min(Math.max(0, d.s + dx), total - len);
        onTrim(s, s + len);
      } else if (d.kind === "key") {
        const nt = Number(t.toFixed(2));
        const key = keys.find((k) => k.t === d.t);
        if (!key) return;
        const rest = keys.filter((k) => k.t !== d.t);
        dragRef.current = { kind: "key", t: nt, x: ev.clientX };
        onKeysChange([...rest, { ...key, t: nt }].sort((a, b) => a.t - b.t));
      }
    };
    const up = () => (dragRef.current = null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [timeAt, onSeek, onTrim, onKeysChange, keys, start, end, total, pps]);

  /** mantém o playhead visível ao rodar */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = time * pps;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    }
  }, [time, pps]);

  const ticks = useMemo(() => {
    const step = pps > 160 ? 0.5 : pps > 90 ? 1 : pps > 40 ? 2 : 5;
    return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  }, [total, pps]);

  const sel = { left: start * pps, width: Math.max(6, (end - start) * pps) };

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onTogglePlay}
          className="rounded-md border border-border p-1.5 text-foreground hover:border-primary"
          aria-label={playing ? "pausar" : "reproduzir"}
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <button
          onClick={() => onSeek(start)}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-primary"
          aria-label="ir para o início do corte"
        >
          <SkipBack className="size-3.5" />
        </button>
        <button
          onClick={() => onSeek(Math.max(start, end - 0.1))}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-primary"
          aria-label="ir para o fim do corte"
        >
          <SkipForward className="size-3.5" />
        </button>
        <span className="font-mono text-[11px] text-foreground">
          {fmt(time)} <span className="text-muted-foreground">/ {fmt(total)}</span>
        </span>
        <span className="font-mono text-[11px] text-primary">corte {fmt(Math.max(0, end - start))}</span>
        <button
          onClick={onAddKey}
          className="ml-auto rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
        >
          <Diamond className="mr-1 inline size-3" /> keyframe
        </button>
        <button
          onClick={() => setPps((p) => Math.max(15, p - 20))}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-primary"
          aria-label="menos zoom"
        >
          <ZoomOut className="size-3.5" />
        </button>
        <button
          onClick={() => setPps((p) => Math.min(400, p + 20))}
          className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-primary"
          aria-label="mais zoom"
        >
          <ZoomIn className="size-3.5" />
        </button>
      </div>

      <div ref={scrollRef} className="overflow-x-auto">
        <div
          ref={trackRef}
          className="relative select-none"
          style={{ width }}
          onPointerDown={(e) => {
            dragRef.current = { kind: "scrub" };
            onSeek(timeAt(e.clientX));
          }}
        >
          {/* régua */}
          <div className="relative h-5 border-b border-border">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute top-0 h-full border-l border-border pl-1 font-mono text-[9px] text-muted-foreground"
                style={{ left: t * pps }}
              >
                {t}s
              </span>
            ))}
          </div>

          {/* filmstrip + corte */}
          <div className="relative mt-1 h-16 overflow-hidden rounded-md bg-background">
            <div className="absolute inset-0 flex">
              {(thumbs.length ? thumbs : Array.from({ length: THUMBS }, () => "")).map((src, i) =>
                src ? (
                  <img
                    key={i}
                    src={src}
                    alt=""
                    draggable={false}
                    className="h-full flex-1 object-cover opacity-90"
                    style={{ minWidth: 0 }}
                  />
                ) : (
                  <div key={i} className="h-full flex-1 animate-pulse bg-muted/40" />
                ),
              )}
            </div>

            {/* áreas fora do corte */}
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-background/75" style={{ width: sel.left }} />
            <div
              className="pointer-events-none absolute inset-y-0 bg-background/75"
              style={{ left: sel.left + sel.width, right: 0 }}
            />

            {/* transições */}
            {transIn.kind !== "none" && (
              <div
                className="pointer-events-none absolute inset-y-0 bg-gradient-to-r from-primary/50 to-transparent"
                style={{ left: sel.left, width: Math.min(sel.width, transIn.dur * pps) }}
              />
            )}
            {transOut.kind !== "none" && (
              <div
                className="pointer-events-none absolute inset-y-0 bg-gradient-to-l from-primary/50 to-transparent"
                style={{
                  left: Math.max(sel.left, sel.left + sel.width - transOut.dur * pps),
                  width: Math.min(sel.width, transOut.dur * pps),
                }}
              />
            )}

            {/* seleção arrastável */}
            <div
              className="absolute inset-y-0 cursor-grab border-2 border-primary"
              style={{ left: sel.left, width: sel.width }}
              onPointerDown={(e) => {
                e.stopPropagation();
                dragRef.current = { kind: "range", x: e.clientX, s: start, e: end };
              }}
            />
            {(["in", "out"] as const).map((k) => (
              <div
                key={k}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = { kind: k };
                }}
                className="absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center rounded-sm bg-primary"
                style={{ left: k === "in" ? sel.left - 1 : sel.left + sel.width - 11 }}
                title={k === "in" ? "início do corte" : "fim do corte"}
              >
                <span className="h-5 w-px bg-primary-foreground/70" />
              </div>
            ))}
          </div>

          {/* keyframes */}
          <div className="relative mt-1 h-6 rounded-md border border-border bg-background">
            <span className="pointer-events-none absolute left-1 top-1 font-mono text-[9px] text-muted-foreground">
              enquadramento
            </span>
            {keys.map((k) => (
              <span
                key={k.t}
                title={`keyframe ${fmt(k.t)} · duplo clique remove`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = { kind: "key", t: k.t, x: e.clientX };
                  onSeek(k.t);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onKeysChange(keys.filter((x) => x.t !== k.t));
                }}
                className="absolute top-1.5 size-3 rotate-45 cursor-ew-resize border border-primary bg-primary/80"
                style={{ left: k.t * pps - 6 }}
              />
            ))}
          </div>

          {/* legendas */}
          {!!cues?.length && (
            <div className="relative mt-1 h-7 rounded-md border border-border bg-background">
              {cues.map((c, i) => (
                <button
                  key={`${i}-${c.start}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSeek(c.start);
                  }}
                  className="absolute top-1 flex h-5 items-center overflow-hidden rounded border border-primary/40 bg-primary/10 px-1 font-mono text-[9px] text-foreground"
                  style={{ left: c.start * pps, width: Math.max(12, (c.end - c.start) * pps) }}
                  title={c.words.map((w) => w.text).join(" ")}
                >
                  <span className="truncate">{c.words.map((w) => w.text).join(" ")}</span>
                </button>
              ))}
            </div>
          )}

          {/* playhead */}
          <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-destructive" style={{ left: time * pps }}>
            <span className="absolute -left-[5px] top-0 size-2.5 rounded-full bg-destructive" />
          </div>
        </div>
      </div>
    </div>
  );
}
