import { useEffect, useRef, useState } from "react";
import {
  CANVAS_H,
  CANVAS_W,
  LAYER_LABELS,
  type LayerId,
  type SelId,
  type Template,
} from "@/lib/template";
import { drawFrame, preloadImage, resetPatchCache, type DrawOpts } from "@/lib/draw";

type Rect = { x: number; y: number; w: number; h: number };

const FIXED_KEY: Record<LayerId, keyof Template> = {
  video: "video",
  watermark: "watermark",
  avatar: "avatar",
  name: "name_",
  handle: "handle",
  headline: "headline",
  cta: "cta",
  captions: "captions",
};

const ORDER: LayerId[] = [
  "video",
  "avatar",
  "name",
  "handle",
  "headline",
  "cta",
  "captions",
  "watermark",
];

function isExtra(id: SelId): id is string {
  return typeof id === "string" && id.startsWith("extra:");
}

function layerOf(t: Template, id: SelId): (Rect & { visible: boolean }) | null {
  if (isExtra(id)) {
    const found = (t.extras ?? []).find((e) => `extra:${e.id}` === id);
    return found ?? null;
  }
  const key = FIXED_KEY[id as LayerId];
  const l = t[key] as unknown as (Rect & { visible: boolean }) | undefined;
  return l ?? null;
}

function rectOf(t: Template, id: SelId): Rect | null {
  const l = layerOf(t, id);
  if (!l) return null;
  const h =
    "size" in (l as object) && (l as { h?: number }).h == null
      ? (l as unknown as { size: number }).size * 1.2
      : l.h;
  return { x: l.x, y: l.y, w: l.w, h };
}

function applyRect(t: Template, id: SelId, r: Partial<Rect>): Template {
  if (isExtra(id)) {
    return {
      ...t,
      extras: (t.extras ?? []).map((e) => (`extra:${e.id}` === id ? { ...e, ...r } : e)),
    };
  }
  const key = FIXED_KEY[id as LayerId];
  const cur = t[key] as unknown as Rect;
  if (!cur) return t;
  return { ...t, [key]: { ...cur, ...r } } as Template;
}

function labelOf(t: Template, id: SelId) {
  if (isExtra(id)) return (t.extras ?? []).find((e) => `extra:${e.id}` === id)?.label ?? "Camada";
  return LAYER_LABELS[id as LayerId];
}

/** Todas as camadas selecionáveis, incluindo as livres. */
export function selectableIds(t: Template): SelId[] {
  return [...ORDER.filter((id) => layerOf(t, id)), ...(t.extras ?? []).map((e) => `extra:${e.id}`)];
}

type Guide = { axis: "x" | "y"; pos: number };
const SNAP = 14;

function snapValue(
  value: number,
  size: number,
  targets: number[],
  guides: Guide[],
  axis: "x" | "y",
): number {
  const edges = [value, value + size / 2, value + size];
  let best: { delta: number; pos: number } | null = null;
  for (const t of targets) {
    for (let i = 0; i < edges.length; i++) {
      const delta = t - edges[i]!;
      if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, pos: t };
      }
    }
  }
  if (!best) return value;
  guides.push({ axis, pos: best.pos });
  return Math.round(value + best.delta);
}

export function TemplateCanvas({
  template,
  selected,
  onSelect,
  onChange,
  interactive = true,
  poster,
  previewFile,
  drawOpts,
  snap = true,
  speed = 1,
  loopStart = 0,
  loopEnd,
  videoRef,
  debug = false,
  debugGrid = 3,
  debugSafeArea = true,
  debugBoxes = true,
}: {
  template: Template;
  selected?: SelId | null;
  onSelect?: (id: SelId) => void;
  onChange?: (t: Template) => void;
  interactive?: boolean;
  poster?: string | null;
  previewFile?: File | null;
  drawOpts?: DrawOpts | undefined;
  snap?: boolean;
  /** velocidade anti-duplicidade aplicada na prévia */
  speed?: number;
  /** janela exportada (clipagem + corte anti-duplicidade), em segundos do vídeo fonte */
  loopStart?: number;
  loopEnd?: number | undefined;
  /** expõe o <video> da prévia (usado pelo mini editor de keyframes) */
  videoRef?: { current: HTMLVideoElement | null };
  /** modo de depuração: grade, áreas seguras e caixas das camadas */
  debug?: boolean;
  /** divisões da grade (2 = metades, 3 = terços...) */
  debugGrid?: number;
  debugSafeArea?: boolean;
  debugBoxes?: boolean;
}) {



  const W = template.canvasW ?? CANVAS_W;
  const H = template.canvasH ?? CANVAS_H;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const posterImg = useRef<HTMLImageElement | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

  useEffect(() => {
    if (!poster) {
      posterImg.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => (posterImg.current = img);
    img.src = poster;
  }, [poster]);

  const videoEl = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!previewFile) {
      videoEl.current = null;
      if (videoRef) videoRef.current = null;
      return;
    }
    const url = URL.createObjectURL(previewFile);
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    // repete exatamente a janela que será exportada (clipe + corte anti-duplicidade)
    const onLoop = () => {
      const end = Math.min(loopEnd ?? Infinity, v.duration || Infinity);
      if (v.currentTime < loopStart - 0.05 || v.currentTime >= end) v.currentTime = loopStart;
    };
    v.addEventListener("loadedmetadata", onLoop);
    v.addEventListener("timeupdate", onLoop);
    void v.play().catch(() => undefined);
    videoEl.current = v;
    if (videoRef) videoRef.current = v;
    return () => {
      v.removeEventListener("loadedmetadata", onLoop);
      v.removeEventListener("timeupdate", onLoop);
      v.pause();
      videoEl.current = null;
      if (videoRef) videoRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [previewFile, loopStart, loopEnd, videoRef]);



  // velocidade anti-duplicidade em tempo real
  useEffect(() => {
    if (videoEl.current) videoEl.current.playbackRate = Math.max(0.25, Math.min(4, speed || 1));
  }, [speed, previewFile]);

  // trocou o vídeo ou as áreas de limpeza: a reconstrução em cache não vale mais
  useEffect(() => {
    resetPatchCache();
  }, [previewFile, template.cleanup]);


  useEffect(() => {
    for (const src of [template.avatar.src, template.watermark.src]) {
      if (src) void preloadImage(src);
    }
    for (const e of template.extras ?? []) {
      if ("src" in e && e.src) void preloadImage(e.src);
    }
  }, [template.avatar.src, template.watermark.src, template.extras]);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        const vid = videoEl.current;
        const p = posterImg.current;
        const source = vid && vid.videoWidth
          ? { el: vid, width: vid.videoWidth, height: vid.videoHeight }
          : p
            ? { el: p, width: p.naturalWidth, height: p.naturalHeight }
            : null;
        const time = vid?.currentTime ?? (performance.now() - t0) / 1000;
        drawFrame(ctx, template, source, { ...drawOpts, time });
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [template, drawOpts]);

  const drag = (id: SelId, mode: "move" | "resize") => (e: React.PointerEvent) => {
    if (!interactive || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(id);
    const startRect = rectOf(template, id);
    if (!startRect) return;
    const box = wrapRef.current!.getBoundingClientRect();
    const scale = W / box.width;
    const start = { mx: e.clientX, my: e.clientY, ...startRect };

    // alvos de alinhamento: bordas/centro do canvas + bordas das outras camadas
    const others = selectableIds(template)
      .filter((oid) => oid !== id)
      .map((oid) => rectOf(template, oid))
      .filter(Boolean) as Rect[];
    const xTargets = [0, W / 2, W, 60, W - 60, ...others.flatMap((r) => [r.x, r.x + r.w / 2, r.x + r.w])];
    const yTargets = [0, H / 2, H, 60, H - 60, ...others.flatMap((r) => [r.y, r.y + r.h / 2, r.y + r.h])];

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.mx) * scale;
      const dy = (ev.clientY - start.my) * scale;
      const g: Guide[] = [];
      if (mode === "move") {
        let x = Math.round(start.x + dx);
        let y = Math.round(start.y + dy);
        if (snap && !ev.altKey) {
          x = snapValue(x, start.w, xTargets, g, "x");
          y = snapValue(y, start.h, yTargets, g, "y");
        }
        onChange(applyRect(template, id, { x, y }));
      } else {
        const w = Math.max(40, Math.round(start.w + dx));
        const h = Math.max(30, Math.round(start.h + dy));
        onChange(applyRect(template, id, { w, h }));
      }
      setGuides(g);
    };
    const up = () => {
      setGuides([]);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ids = selectableIds(template);

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-border bg-black"
      style={{ aspectRatio: `${W}/${H}` }}
    >
      <canvas ref={canvasRef} width={W} height={H} className="block h-full w-full" />
      {interactive &&
        ids.map((id) => {
          const l = layerOf(template, id);
          const r = rectOf(template, id);
          if (!l || !r || !l.visible) return null;
          const sel = selected === id;
          return (
            <div
              key={id}
              title={labelOf(template, id)}
              onPointerDown={drag(id, "move")}
              className={`absolute cursor-move ${sel ? "border-2 border-primary" : "border border-transparent hover:border-primary/40"}`}
              style={{
                left: `${(r.x / W) * 100}%`,
                top: `${(r.y / H) * 100}%`,
                width: `${(r.w / W) * 100}%`,
                height: `${(r.h / H) * 100}%`,
              }}
            >
              {sel && (
                <span
                  onPointerDown={drag(id, "resize")}
                  className="absolute -right-1.5 -bottom-1.5 size-3 cursor-se-resize rounded-[2px] bg-primary"
                />
              )}
            </div>
          );
        })}
      {guides.map((g, i) => (
        <div
          key={i}
          className="pointer-events-none absolute bg-warn/90"
          style={
            g.axis === "x"
              ? { left: `${(g.pos / W) * 100}%`, top: 0, bottom: 0, width: 1 }
              : { top: `${(g.pos / H) * 100}%`, left: 0, right: 0, height: 1 }
          }
        />
      ))}
    </div>
  );
}

export { ORDER as LAYER_ORDER, layerOf, LAYER_LABELS, isExtra };
