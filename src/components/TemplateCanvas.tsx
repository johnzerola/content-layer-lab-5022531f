import { useEffect, useRef, useState } from "react";
import { CANVAS_H, CANVAS_W, LAYER_LABELS, type LayerId, type Template } from "@/lib/template";
import { drawFrame, preloadImage } from "@/lib/draw";

type Rect = { x: number; y: number; w: number; h: number };

function rectOf(t: Template, id: LayerId): Rect {
  switch (id) {
    case "video":
      return t.video;
    case "watermark":
      return t.watermark;
    case "avatar":
      return t.avatar;
    case "name":
      return { x: t.name_.x, y: t.name_.y, w: t.name_.w, h: t.name_.size * 1.2 };
    case "handle":
      return { x: t.handle.x, y: t.handle.y, w: t.handle.w, h: t.handle.size * 1.2 };
    case "headline":
      return { x: t.headline.x, y: t.headline.y, w: t.headline.w, h: t.headline.h };
    case "cta":
      return { x: t.cta.x, y: t.cta.y, w: t.cta.w, h: t.cta.h };
  }
}

function isVisible(t: Template, id: LayerId) {
  return layerOf(t, id).visible;
}

function layerOf(t: Template, id: LayerId) {
  const map = {
    video: t.video,
    watermark: t.watermark,
    avatar: t.avatar,
    name: t.name_,
    handle: t.handle,
    headline: t.headline,
    cta: t.cta,
  } as const;
  return map[id];
}

function applyRect(t: Template, id: LayerId, r: Partial<Rect>): Template {
  const key = { video: "video", watermark: "watermark", avatar: "avatar", name: "name_", handle: "handle", headline: "headline", cta: "cta" }[id] as keyof Template;
  const cur = t[key] as unknown as Rect;
  return { ...t, [key]: { ...cur, ...r } } as Template;
}

const ORDER: LayerId[] = ["video", "avatar", "name", "handle", "headline", "cta", "watermark"];

export function TemplateCanvas({
  template,
  selected,
  onSelect,
  onChange,
  interactive = true,
  poster,
}: {
  template: Template;
  selected?: LayerId | null;
  onSelect?: (id: LayerId) => void;
  onChange?: (t: Template) => void;
  interactive?: boolean;
  poster?: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const posterImg = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!poster) {
      posterImg.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => (posterImg.current = img);
    img.src = poster;
  }, [poster]);

  useEffect(() => {
    for (const src of [template.avatar.src, template.watermark.src]) {
      if (src) void preloadImage(src);
    }
  }, [template.avatar.src, template.watermark.src]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        const p = posterImg.current;
        drawFrame(
          ctx,
          template,
          p ? { el: p, width: p.naturalWidth, height: p.naturalHeight } : null,
        );
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [template]);

  const drag = (id: LayerId, mode: "move" | "resize") => (e: React.PointerEvent) => {
    if (!interactive || !onChange) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(id);
    const box = wrapRef.current!.getBoundingClientRect();
    const scale = CANVAS_W / box.width;
    const start = { mx: e.clientX, my: e.clientY, ...rectOf(template, id) };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.mx) * scale;
      const dy = (ev.clientY - start.my) * scale;
      if (mode === "move") {
        onChange(applyRect(template, id, { x: Math.round(start.x + dx), y: Math.round(start.y + dy) }));
      } else {
        const w = Math.max(40, Math.round(start.w + dx));
        const h = Math.max(30, Math.round(start.h + dy));
        onChange(applyRect(template, id, { w, h }));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl border border-border bg-black"
      style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
    >
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="block h-full w-full" />
      {interactive &&
        ORDER.filter((id) => isVisible(template, id)).map((id) => {
          const r = rectOf(template, id);
          const sel = selected === id;
          return (
            <div
              key={id}
              onPointerDown={drag(id, "move")}
              className={`absolute cursor-move ${sel ? "border-2 border-primary" : "border border-transparent hover:border-primary/40"}`}
              style={{
                left: `${(r.x / CANVAS_W) * 100}%`,
                top: `${(r.y / CANVAS_H) * 100}%`,
                width: `${(r.w / CANVAS_W) * 100}%`,
                height: `${(r.h / CANVAS_H) * 100}%`,
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
    </div>
  );
}

export { ORDER as LAYER_ORDER, layerOf, LAYER_LABELS };
