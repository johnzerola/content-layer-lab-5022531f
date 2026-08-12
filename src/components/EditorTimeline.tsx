import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsLeftRight,
  Diamond,
  Magnet,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { FrameKey, Segment, Transition } from "@/lib/preedit";
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
  cues?: CaptionCue[] | null | undefined;
  /** trechos mantidos (corte multi-segmento) */
  segments?: Segment[] | undefined;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onTrim: (start: number, end: number) => void;
  onKeysChange: (keys: FrameKey[]) => void;
  /** grava um keyframe no tempo atual usando o recorte corrente */
  onAddKey: () => void;
  /** divide o trecho no playhead (tesoura / tecla S) */
  onSplit?: (() => void) | undefined;
  /** remove um trecho da sequência final */
  onDeleteSegment?: ((index: number) => void) | undefined;
}


const FPS = 30;

/** timecode estilo NLE: m:ss:ff */
const fmt = (s: number) => {
  const safe = Math.max(0, s);
  const m = Math.floor(safe / 60);
  const sec = Math.floor(safe - m * 60);
  const f = Math.min(FPS - 1, Math.floor((safe - Math.floor(safe)) * FPS));
  return `${m}:${String(sec).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
};

const THUMBS = 32;
const MIN_PPS = 8;
const MAX_PPS = 600;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Timeline de edição: filmstrip, waveform, corte, playhead, keyframes e legendas. */
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
  segments,
  onSeek,
  onTogglePlay,
  onTrim,
  onKeysChange,
  onAddKey,
  onSplit,
  onDeleteSegment,
}: Props) {

  const [pps, setPps] = useState(60);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [snap, setSnap] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
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

  /** waveform do áudio (picos normalizados) */
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const run = async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const Ctx: typeof AudioContext =
          window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = new Ctx();
        const audio = await ac.decodeAudioData(buf);
        const data = audio.getChannelData(0);
        const N = 900;
        const step = Math.max(1, Math.floor(data.length / N));
        const out: number[] = [];
        let max = 0.0001;
        for (let i = 0; i < N; i++) {
          let peak = 0;
          const base = i * step;
          for (let j = 0; j < step; j += 8) {
            const val = Math.abs(data[base + j] ?? 0);
            if (val > peak) peak = val;
          }
          max = Math.max(max, peak);
          out.push(peak);
        }
        void ac.close();
        if (!cancelled) setPeaks(out.map((p) => p / max));
      } catch {
        if (!cancelled) setPeaks(null);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [url]);

  /** pontos de encaixe (magnet) */
  const snapPoints = useMemo(() => {
    const pts = [0, total, start, end, ...keys.map((k) => k.t)];
    for (const c of cues ?? []) pts.push(c.start, c.end);
    return pts;
  }, [total, start, end, keys, cues]);

  const applySnap = useCallback(
    (t: number) => {
      if (!snap) return t;
      const tol = 8 / pps;
      let best = t;
      let dist = tol;
      for (const p of snapPoints) {
        const d = Math.abs(p - t);
        if (d < dist) {
          dist = d;
          best = p;
        }
      }
      return best;
    },
    [snap, pps, snapPoints],
  );

  const timeAt = useCallback(
    (clientX: number) => {
      const box = trackRef.current?.getBoundingClientRect();
      if (!box) return 0;
      return clamp((clientX - box.left) / pps, 0, total);
    },
    [pps, total],
  );

  useEffect(() => {
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const t = applySnap(timeAt(ev.clientX));
      if (d.kind === "scrub") onSeek(t);
      else if (d.kind === "in") onTrim(Math.min(t, end - 0.3), end);
      else if (d.kind === "out") onTrim(start, Math.max(t, start + 0.3));
      else if (d.kind === "range") {
        const dx = (ev.clientX - d.x) / pps;
        const len = d.e - d.s;
        const s = clamp(d.s + dx, 0, total - len);
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
  }, [timeAt, applySnap, onSeek, onTrim, onKeysChange, keys, start, end, total, pps]);

  /** zoom com a roda ancorado no cursor (listener não passivo) */
  const zoomRef = useRef({ pps, total });
  zoomRef.current = { pps, total };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const cur = zoomRef.current.pps;
      const next = clamp(cur * Math.exp(-dy * 0.0018), MIN_PPS, MAX_PPS);
      if (next === cur) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left + el.scrollLeft;
      const k = next / cur;
      setPps(next);
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, px * k - (e.clientX - rect.left));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** atalhos de teclado estilo NLE */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /input|textarea|select/i.test(el.tagName)) return;
      const frame = 1 / FPS;
      switch (e.key.toLowerCase()) {
        case " ":
        case "k":
          e.preventDefault();
          onTogglePlay();
          break;
        case "arrowleft":
          e.preventDefault();
          onSeek(clamp(time - (e.shiftKey ? 1 : frame), 0, total));
          break;
        case "arrowright":
          e.preventDefault();
          onSeek(clamp(time + (e.shiftKey ? 1 : frame), 0, total));
          break;
        case "i":
          onTrim(Math.min(time, end - 0.3), end);
          break;
        case "o":
          onTrim(start, Math.max(time, start + 0.3));
          break;
        case "j":
          onSeek(clamp(time - 1, 0, total));
          break;
        case "l":
          onSeek(clamp(time + 1, 0, total));
          break;
        case "m":
          onAddKey();
          break;
        case "s":
          e.preventDefault();
          onSplit?.();
          break;
        case "home":
          onSeek(start);
          break;
        case "end":
          onSeek(Math.max(start, end - 0.1));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [time, start, end, total, onSeek, onTrim, onTogglePlay, onAddKey, onSplit]);


  /** mantém o playhead visível ao rodar */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || dragRef.current) return;
    const x = time * pps;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    }
  }, [time, pps]);

  const fitAll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPps(clamp((el.clientWidth - 16) / total, MIN_PPS, MAX_PPS));
    el.scrollLeft = 0;
  };

  const ticks = useMemo(() => {
    const step = pps > 240 ? 0.25 : pps > 160 ? 0.5 : pps > 90 ? 1 : pps > 40 ? 2 : pps > 20 ? 5 : 10;
    return Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => Number((i * step).toFixed(2)));
  }, [total, pps]);

  const sel = { left: start * pps, width: Math.max(6, (end - start) * pps) };

  const btn =
    "rounded-md border border-border p-1.5 text-muted-foreground transition hover:border-primary hover:text-foreground";

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onTogglePlay}
          className="rounded-md border border-border bg-primary/10 p-1.5 text-foreground transition hover:border-primary"
          aria-label={playing ? "pausar" : "reproduzir"}
          title="espaço"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <button onClick={() => onSeek(start)} className={btn} aria-label="ir para o início do corte" title="Home">
          <SkipBack className="size-3.5" />
        </button>
        <button
          onClick={() => onSeek(Math.max(start, end - 0.1))}
          className={btn}
          aria-label="ir para o fim do corte"
          title="End"
        >
          <SkipForward className="size-3.5" />
        </button>

        <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-foreground">
          {fmt(time)} <span className="text-muted-foreground">/ {fmt(total)}</span>
        </span>
        <span className="font-mono text-[11px] text-primary">
          <Scissors className="mr-1 inline size-3" />
          {fmt(Math.max(0, end - start))}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {onSplit && (
            <button
              onClick={onSplit}
              className="rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition hover:border-primary hover:text-foreground"
              title="S — dividir no playhead"
            >
              <Scissors className="mr-1 inline size-3" /> dividir
            </button>
          )}
          <button
            onClick={onAddKey}
            className="rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition hover:border-primary hover:text-foreground"
            title="M"
          >
            <Diamond className="mr-1 inline size-3" /> keyframe
          </button>

          <button
            onClick={() => setSnap((s) => !s)}
            className={`rounded-md border p-1.5 transition ${
              snap ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
            }`}
            aria-label="encaixe magnético"
            title="encaixe magnético"
          >
            <Magnet className="size-3.5" />
          </button>
          <button onClick={fitAll} className={btn} aria-label="ajustar à janela" title="ajustar à janela">
            <ChevronsLeftRight className="size-3.5" />
          </button>
          <button
            onClick={() => setPps((p) => clamp(p / 1.4, MIN_PPS, MAX_PPS))}
            className={btn}
            aria-label="menos zoom"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <button
            onClick={() => setPps((p) => clamp(p * 1.4, MIN_PPS, MAX_PPS))}
            className={btn}
            aria-label="mais zoom"
          >
            <ZoomIn className="size-3.5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto overscroll-x-contain">
        <div
          ref={trackRef}
          className="relative select-none"
          style={{ width }}
          onPointerDown={(e) => {
            dragRef.current = { kind: "scrub" };
            onSeek(applySnap(timeAt(e.clientX)));
          }}
          onPointerMove={(e) => setHover(timeAt(e.clientX))}
          onPointerLeave={() => setHover(null)}
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
              className="absolute inset-y-0 cursor-grab border-2 border-primary active:cursor-grabbing"
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
                title={k === "in" ? "início do corte (I)" : "fim do corte (O)"}
              >
                <span className="h-5 w-px bg-primary-foreground/70" />
              </div>
            ))}
          </div>

          {/* waveform */}
          <div className="relative mt-1 h-10 overflow-hidden rounded-md border border-border bg-background">
            <span className="pointer-events-none absolute left-1 top-0.5 font-mono text-[9px] text-muted-foreground">
              áudio
            </span>
            {peaks ? (
              <svg
                className="absolute inset-0 size-full"
                viewBox={`0 0 ${peaks.length} 100`}
                preserveAspectRatio="none"
                aria-hidden
              >
                {peaks.map((p, i) => (
                  <rect
                    key={i}
                    x={i}
                    y={50 - p * 46}
                    width={1}
                    height={Math.max(1, p * 92)}
                    className="fill-primary/60"
                  />
                ))}
              </svg>
            ) : (
              <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            )}
            <div className="pointer-events-none absolute inset-y-0 left-0 bg-background/70" style={{ width: sel.left }} />
            <div
              className="pointer-events-none absolute inset-y-0 bg-background/70"
              style={{ left: sel.left + sel.width, right: 0 }}
            />
          </div>

          {/* trechos (corte multi-segmento) */}
          {!!segments?.length && (
            <div className="relative mt-1 h-8 rounded-md border border-border bg-background">
              <span className="pointer-events-none absolute left-1 top-0.5 font-mono text-[9px] text-muted-foreground">
                trechos
              </span>
              {/* lacunas removidas */}
              {segments.map((s, i) => {
                const prev = i === 0 ? start : segments[i - 1]!.end;
                const gap = s.start - prev;
                if (gap <= 0.02) return null;
                return (
                  <span
                    key={`gap-${i}`}
                    className="absolute bottom-0.5 top-3 rounded-sm border border-destructive/40 bg-destructive/15"
                    style={{ left: prev * pps, width: Math.max(2, gap * pps) }}
                    title={`removido · ${fmt(gap)}`}
                  />
                );
              })}
              {segments.map((s, i) => (
                <span
                  key={`${i}-${s.start}`}
                  className="absolute bottom-0.5 top-3 flex items-center justify-between gap-1 overflow-hidden rounded border border-primary/60 bg-primary/20 px-1 font-mono text-[9px] text-foreground"
                  style={{ left: s.start * pps, width: Math.max(16, (s.end - s.start) * pps) }}
                  title={`trecho ${i + 1} · ${fmt(s.end - s.start)}`}
                >
                  <button
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSeek(s.start);
                    }}
                    className="truncate"
                  >
                    {i + 1} · {fmt(s.end - s.start)}
                  </button>
                  {onDeleteSegment && segments.length > 1 && (
                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onDeleteSegment(i);
                      }}
                      className="shrink-0 text-destructive"
                      aria-label={`remover trecho ${i + 1}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}


          {/* keyframes */}

          <div className="relative mt-1 h-6 rounded-md border border-border bg-background">
            <span className="pointer-events-none absolute left-1 top-1 font-mono text-[9px] text-muted-foreground">
              enquadramento
            </span>
            {keys.length > 1 && (
              <span
                className="pointer-events-none absolute top-1/2 h-px bg-primary/40"
                style={{
                  left: (keys[0]?.t ?? 0) * pps,
                  width: Math.max(0, ((keys[keys.length - 1]?.t ?? 0) - (keys[0]?.t ?? 0)) * pps),
                }}
              />
            )}
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
                className="absolute top-1.5 size-3 rotate-45 cursor-ew-resize border border-primary bg-primary/80 transition hover:scale-125"
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
                  className="absolute top-1 flex h-5 items-center overflow-hidden rounded border border-primary/40 bg-primary/10 px-1 font-mono text-[9px] text-foreground transition hover:bg-primary/20"
                  style={{ left: c.start * pps, width: Math.max(12, (c.end - c.start) * pps) }}
                  title={c.words.map((w) => w.text).join(" ")}
                >
                  <span className="truncate">{c.words.map((w) => w.text).join(" ")}</span>
                </button>
              ))}
            </div>
          )}

          {/* cursor fantasma */}
          {hover !== null && !dragRef.current && (
            <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground/25" style={{ left: hover * pps }}>
              <span className="absolute -top-0.5 left-1 rounded bg-background/90 px-1 font-mono text-[9px] text-muted-foreground">
                {fmt(hover)}
              </span>
            </div>
          )}

          {/* playhead */}
          <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-destructive" style={{ left: time * pps }}>
            <span className="absolute -left-[5px] top-0 size-2.5 rounded-full bg-destructive" />
          </div>
        </div>
      </div>

      <p className="px-1 font-mono text-[9px] text-muted-foreground">
        espaço play · J/L ±1s · ←/→ frame · I/O marcar corte · S dividir · M keyframe · roda = zoom
      </p>
    </div>
  );
}
