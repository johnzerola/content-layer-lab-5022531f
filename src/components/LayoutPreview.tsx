import { useEffect, useRef } from "react";
import { drawFrame } from "@/lib/draw";
import { createTemplate, type Template } from "@/lib/template";
import type { PreEdit } from "@/lib/preedit";

/** Mini saída 9:16 desenhada com o MESMO pipeline da exportação (draw.ts),
 *  para o layout escolhido aparecer igualzinho antes de processar. */
export function LayoutPreview({
  videoRef,
  pre,
  clip,
  className,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  pre: PreEdit;
  clip?: { start: number; end: number } | null;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preRef = useRef(pre);
  preRef.current = pre;
  const clipRef = useRef(clip);
  clipRef.current = clip;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t: Template = createTemplate("layout-preview");
    const W = t.canvasW ?? 1080;
    const H = t.canvasH ?? 1920;
    t.background = "#000000";
    t.video = { ...t.video, x: 0, y: 0, w: W, h: H, radius: 0, fit: "auto" };
    t.avatar.visible = false;
    t.name_.visible = false;
    t.handle.visible = false;
    t.headline.visible = false;
    t.cta.visible = false;
    t.watermark.visible = false;
    if (t.captions) t.captions.visible = false;

    canvas.width = 270;
    canvas.height = 480;
    let raf = 0;
    const loop = () => {
      const el = videoRef.current;
      ctx.save();
      ctx.scale(canvas.width / W, canvas.height / H);
      if (el && el.videoWidth) {
        drawFrame(
          ctx,
          t,
          { el, width: el.videoWidth, height: el.videoHeight },
          { pre: preRef.current, time: el.currentTime, clip: clipRef.current ?? null },
        );
      } else {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "mx-auto h-56 w-auto rounded-lg border border-border bg-black"}
    />
  );
}
