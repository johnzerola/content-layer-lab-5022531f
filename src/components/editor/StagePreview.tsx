import { useEffect, useRef } from "react";
import { drawFrame } from "@/lib/draw";
import { createTemplate, type Template } from "@/lib/template";
import type { PreEdit } from "@/lib/preedit";
import type { CaptionCue } from "@/lib/captions";

/** Palco de saída 9:16 desenhado com o MESMO pipeline da exportação (draw.ts):
 *  o que aparece aqui é exatamente o que sai no MP4. */
export function StagePreview({
  videoRef,
  pre,
  clip,
  captions,
  /** true = ignora a pré-edição (comparar antes/depois) */
  bypass,
  safeArea,
  thirds,
  className,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  pre: PreEdit;
  clip?: { start: number; end: number } | null;
  captions?: CaptionCue[] | undefined;
  bypass?: boolean;
  safeArea?: boolean;
  thirds?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preRef = useRef(pre);
  preRef.current = pre;
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const capRef = useRef(captions);
  capRef.current = captions;
  const bypassRef = useRef(bypass);
  bypassRef.current = bypass;
  const variationRef = useRef(variation);
  variationRef.current = variation;


  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t: Template = createTemplate("stage-preview");
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

    canvas.width = 540;
    canvas.height = 960;
    let raf = 0;
    const loop = () => {
      const el = videoRef.current;
      ctx.save();
      ctx.scale(canvas.width / W, canvas.height / H);
      if (el && el.videoWidth) {
        const cues = capRef.current;
        if (t.captions) t.captions.visible = Boolean(cues?.length);
        drawFrame(
          ctx,
          t,
          { el, width: el.videoWidth, height: el.videoHeight },
          {
            time: el.currentTime,
            ...(bypassRef.current
              ? {}
              : {
                  pre: preRef.current,
                  clip: clipRef.current ?? null,
                  ...(cues?.length || preRef.current.captionStyle ? { captions: cues } : {}),
                  variation: variationRef.current,
                }),
          },
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
    <div className={`relative ${className ?? ""}`}>
      <canvas ref={canvasRef} className="size-full rounded-xl bg-black object-contain" />
      {thirds && (
        <div className="pointer-events-none absolute inset-0 opacity-50">
          <div className="absolute inset-y-0 left-1/3 w-px bg-primary/40" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-primary/40" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-primary/40" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-primary/40" />
        </div>
      )}
      {safeArea && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-[6%] top-[10%] bottom-[18%] rounded-md border border-dashed border-primary/50" />
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-background/80 px-1.5 font-mono text-[9px] text-muted-foreground">
            área segura
          </span>
        </div>
      )}
    </div>
  );
}
