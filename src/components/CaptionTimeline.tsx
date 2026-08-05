import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { CaptionCue, CaptionWord } from "@/lib/captions";

interface Props {
  file: File;
  cues: CaptionCue[];
  onChange: (cues: CaptionCue[]) => void;
}

type Sel = { c: number; w: number } | null;

const fmt = (t: number) => `${t.toFixed(2)}s`;

/** recalcula start/end do bloco a partir das palavras */
function normalize(cues: CaptionCue[]): CaptionCue[] {
  return cues
    .map((c) => {
      const words = [...c.words].sort((a, b) => a.start - b.start);
      const start = words[0]?.start ?? c.start;
      const end = words[words.length - 1]?.end ?? c.end;
      return { start, end, words };
    })
    .filter((c) => c.words.length)
    .sort((a, b) => a.start - b.start);
}

export function CaptionTimeline({ file, cues, onChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(120); // pixels por segundo
  const [sel, setSel] = useState<Sel>(null);

  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const loop = () => {
      setTime(v.currentTime);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [url]);

  const total = Math.max(dur, cues[cues.length - 1]?.end ?? 0, 1);
  const width = total * pps;

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      const clamped = Math.max(0, Math.min(total, t));
      if (v) v.currentTime = clamped;
      setTime(clamped);
    },
    [total],
  );

  const timeFromEvent = useCallback(
    (clientX: number) => {
      const box = trackRef.current?.getBoundingClientRect();
      if (!box) return 0;
      const scroll = trackRef.current?.parentElement?.scrollLeft ?? 0;
      return (clientX - box.left + scroll - scroll) / pps;
    },
    [pps],
  );

  const patchWord = (ci: number, wi: number, patch: Partial<CaptionWord>) => {
    const next = cues.map((c, i) =>
      i === ci ? { ...c, words: c.words.map((w, j) => (j === wi ? { ...w, ...patch } : w)) } : c,
    );
    onChange(normalize(next));
  };

  const removeWord = (ci: number, wi: number) => {
    const next = cues.map((c, i) => (i === ci ? { ...c, words: c.words.filter((_, j) => j !== wi) } : c));
    setSel(null);
    onChange(normalize(next));
  };

  /** arrasta a palavra (mover) ou uma borda (ajustar tempo) */
  const dragWord =
    (ci: number, wi: number, mode: "move" | "start" | "end") => (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setSel({ c: ci, w: wi });
      const word = cues[ci]?.words[wi];
      if (!word) return;
      const x0 = e.clientX;
      const s0 = word.start;
      const e0 = word.end;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        const d = (ev.clientX - x0) / pps;
        if (mode === "move") patchWord(ci, wi, { start: Math.max(0, s0 + d), end: Math.max(0.05, e0 + d) });
        else if (mode === "start") patchWord(ci, wi, { start: Math.max(0, Math.min(e0 - 0.05, s0 + d)) });
        else patchWord(ci, wi, { end: Math.max(s0 + 0.05, e0 + d) });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  /** divide o bloco na posição do playhead */
  const splitAtPlayhead = () => {
    const ci = cues.findIndex((c) => time > c.start && time < c.end);
    if (ci < 0) return;
    const c = cues[ci]!;
    const a = c.words.filter((w) => w.start < time);
    const b = c.words.filter((w) => w.start >= time);
    if (!a.length || !b.length) return;
    const next = [...cues.slice(0, ci), { ...c, words: a }, { ...c, words: b }, ...cues.slice(ci + 1)];
    onChange(normalize(next));
  };

  const shiftAll = (d: number) =>
    onChange(
      normalize(
        cues.map((c) => ({
          ...c,
          words: c.words.map((w) => ({ ...w, start: Math.max(0, w.start + d), end: Math.max(0.05, w.end + d) })),
        })),
      ),
    );

  const selected = sel ? cues[sel.c]?.words[sel.w] : undefined;
  const activeWord = cues.flatMap((c) => c.words).find((w) => time >= w.start && time <= w.end);

  const ticks = useMemo(() => {
    const step = pps > 160 ? 0.5 : pps > 80 ? 1 : 2;
    return Array.from({ length: Math.ceil(total / step) + 1 }, (_, i) => i * step);
  }, [total, pps]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) {
              void v.play();
              setPlaying(true);
            } else {
              v.pause();
              setPlaying(false);
            }
          }}
          className="rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-primary"
          aria-label={playing ? "pausar" : "reproduzir"}
        >
          {playing ? <Pause className="inline size-3" /> : <Play className="inline size-3" />}{" "}
          {fmt(time)} / {fmt(total)}
        </button>
        <button
          onClick={splitAtPlayhead}
          className="rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-primary"
        >
          <Scissors className="inline size-3" /> dividir aqui
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPps((p) => Math.max(40, p - 30))}
            className="rounded-md border border-border p-1 hover:border-primary"
            aria-label="menos zoom"
          >
            <ZoomOut className="size-3" />
          </button>
          <button
            onClick={() => setPps((p) => Math.min(400, p + 30))}
            className="rounded-md border border-border p-1 hover:border-primary"
            aria-label="mais zoom"
          >
            <ZoomIn className="size-3" />
          </button>
        </div>
        <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          deslocar tudo
          <button onClick={() => shiftAll(-0.1)} className="rounded-md border border-border px-1.5 hover:border-primary">
            -0.1s
          </button>
          <button onClick={() => shiftAll(0.1)} className="rounded-md border border-border px-1.5 hover:border-primary">
            +0.1s
          </button>
        </div>
        <span className="font-mono text-[11px] text-primary">{activeWord?.text ?? "—"}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)}
          onPause={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          className="w-full rounded-lg border border-border bg-black"
        />

        <div className="overflow-x-auto rounded-lg border border-border bg-surface-2">
          <div
            ref={trackRef}
            className="relative select-none"
            style={{ width, minHeight: 108 }}
            onPointerDown={(e) => seek(timeFromEvent(e.clientX))}
          >
            {/* régua */}
            <div className="relative h-5 border-b border-border">
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-0 border-l border-border pl-1 font-mono text-[9px] text-muted-foreground"
                  style={{ left: t * pps, height: "100%" }}
                >
                  {t}s
                </span>
              ))}
            </div>

            {/* blocos e palavras */}
            <div className="relative" style={{ height: 80 }}>
              {cues.map((c, ci) => (
                <div
                  key={`${ci}-${c.start}`}
                  className="absolute top-1 h-6 rounded border border-primary/30 bg-primary/5"
                  style={{ left: c.start * pps, width: Math.max(4, (c.end - c.start) * pps) }}
                />
              ))}
              {cues.map((c, ci) =>
                c.words.map((w, wi) => {
                  const isSel = sel?.c === ci && sel.w === wi;
                  const isActive = time >= w.start && time <= w.end;
                  return (
                    <div
                      key={`${ci}-${wi}-${w.start}`}
                      onPointerDown={dragWord(ci, wi, "move")}
                      className={`absolute top-9 flex h-8 cursor-grab items-center overflow-hidden rounded border px-1 font-mono text-[10px] ${
                        isSel
                          ? "border-primary bg-primary/25 text-foreground"
                          : isActive
                            ? "border-primary/70 bg-primary/15 text-primary"
                            : "border-border bg-background text-muted-foreground"
                      }`}
                      style={{ left: w.start * pps, width: Math.max(10, (w.end - w.start) * pps) }}
                      title={`${w.text} · ${fmt(w.start)}→${fmt(w.end)}`}
                    >
                      <span
                        onPointerDown={dragWord(ci, wi, "start")}
                        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-primary/50"
                      />
                      <span className="truncate pl-1.5 pr-1.5">{w.text}</span>
                      <span
                        onPointerDown={dragWord(ci, wi, "end")}
                        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-primary/50"
                      />
                    </div>
                  );
                }),
              )}
            </div>

            {/* playhead */}
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-primary"
              style={{ left: time * pps }}
            >
              <span className="absolute -left-1 top-0 size-2 rounded-full bg-primary" />
            </div>
          </div>
        </div>
      </div>

      {selected && sel && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-2 p-2">
          <label className="space-y-1">
            <span className="mono-label">Palavra</span>
            <input
              value={selected.text}
              onChange={(e) => patchWord(sel.c, sel.w, { text: e.target.value })}
              className="w-40 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
            />
          </label>
          {(["start", "end"] as const).map((k) => (
            <label key={k} className="space-y-1">
              <span className="mono-label">{k === "start" ? "início (s)" : "fim (s)"}</span>
              <input
                type="number"
                step={0.05}
                value={Number(selected[k].toFixed(2))}
                onChange={(e) => patchWord(sel.c, sel.w, { [k]: Number(e.target.value) } as Partial<CaptionWord>)}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
              />
            </label>
          ))}
          <button
            onClick={() => seek(selected.start)}
            className="rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-primary"
          >
            ir para
          </button>
          <button
            onClick={() => removeWord(sel.c, sel.w)}
            className="rounded-md border border-border px-2 py-1 font-mono text-[11px] text-destructive hover:border-destructive"
          >
            <Trash2 className="inline size-3" /> remover
          </button>
        </div>
      )}
    </div>
  );
}
