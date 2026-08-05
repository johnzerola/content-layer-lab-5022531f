import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Type, Upload } from "lucide-react";
import { drawCaptions } from "@/lib/draw";
import { BUILTIN_FONTS, fileToFont } from "@/lib/fonts";
import { CAPTION_PRESETS, type CaptionStyle, type CustomFont } from "@/lib/template";
import type { CaptionCue } from "@/lib/captions";

interface Props {
  style: CaptionStyle;
  onChange: (patch: Partial<CaptionStyle>) => void;
  cues?: CaptionCue[] | undefined;
  fonts?: CustomFont[] | undefined;
  onAddFont?: (f: CustomFont) => void;
}

const DEMO_TEXT = "isso aqui muda o seu jogo agora mesmo";

function demoCues(): CaptionCue[] {
  const words = DEMO_TEXT.split(" ");
  const step = 0.42;
  return [
    {
      start: 0,
      end: words.length * step,
      words: words.map((text, i) => ({ text, start: i * step, end: (i + 1) * step - 0.02 })),
    },
  ];
}

const input =
  "w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] outline-none focus:border-primary";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="mono-label">{label}</span>
      {children}
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="mono-label flex justify-between">
        <span>{label}</span>
        <span className="text-primary">
          {value}
          {suffix ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--primary)]"
      />
    </label>
  );
}

export function CaptionStudio({ style, onChange, cues, fonts, onAddFont }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const demo = useMemo(() => demoCues(), []);
  const useCues = cues?.length ? cues : demo;
  const start = useCues[0]?.start ?? 0;
  const end = useCues[0]?.end ?? 3;

  const [fontFiles, setFontFiles] = useState(0);
  const allFonts = useMemo(
    () => [...BUILTIN_FONTS, ...(fonts ?? []).map((f) => f.name)],
    [fonts, fontFiles],
  );

  const preset = useCallback(
    (id: string) => {
      const p = CAPTION_PRESETS.find((x) => x.id === id);
      if (p) onChange({ ...p.style, visible: true });
    },
    [onChange],
  );

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const t0 = performance.now();

    const loop = (now: number) => {
      const span = Math.max(0.5, end - start);
      const t = playing ? start + (((now - t0) / 1000) % span) : start + span * 0.45;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#12130f";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, 0, cv.width, cv.height);
      const scale = cv.width / 1080;
      ctx.scale(scale, scale);
      drawCaptions(ctx, { ...style, visible: true }, useCues, t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [style, useCues, playing, start, end]);

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-xl border border-border bg-black">
          <canvas ref={canvasRef} width={324} height={576} className="w-full" />
          <button
            onClick={() => setPlaying((p) => !p)}
            className="absolute bottom-2 right-2 rounded-full border border-border bg-background/80 p-2 hover:border-primary"
            aria-label={playing ? "pausar prévia" : "reproduzir prévia"}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          {cues?.length ? "prévia com a transcrição real" : "prévia com texto de exemplo"}
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <p className="mono-label mb-1.5">Presets</p>
          <div className="flex flex-wrap gap-1.5">
            {CAPTION_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => preset(p.id)}
                className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] hover:border-primary hover:text-primary"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Estilo de legenda">
            <select
              className={input}
              value={style.mode}
              onChange={(e) => onChange({ mode: e.target.value as CaptionStyle["mode"] })}
            >
              <option value="karaoke">Karaokê (destaca a palavra)</option>
              <option value="word">Uma palavra por vez</option>
              <option value="line">Linha inteira</option>
            </select>
          </Field>
          <Field label="Animação">
            <select
              className={input}
              value={style.anim ?? "pop"}
              onChange={(e) => onChange({ anim: e.target.value as NonNullable<CaptionStyle["anim"]> })}
            >
              <option value="pop">Pop</option>
              <option value="bounce">Bounce</option>
              <option value="slide">Slide up</option>
              <option value="fade">Fade</option>
              <option value="typewriter">Máquina de escrever</option>
              <option value="none">Sem animação</option>
            </select>
          </Field>
          <Field label="Destaque">
            <select
              className={input}
              value={style.highlight ?? "color"}
              onChange={(e) => onChange({ highlight: e.target.value as NonNullable<CaptionStyle["highlight"]> })}
            >
              <option value="color">Trocar cor</option>
              <option value="box">Caixa colorida</option>
              <option value="underline">Sublinhado</option>
              <option value="scale">Aumentar palavra</option>
            </select>
          </Field>
          <Field label="Fundo">
            <select
              className={input}
              value={style.bg}
              onChange={(e) => onChange({ bg: e.target.value as CaptionStyle["bg"] })}
            >
              <option value="shadow">Sombra</option>
              <option value="box">Caixa</option>
              <option value="none">Nenhum</option>
            </select>
          </Field>
          <Field label="Fonte">
            <select className={input} value={style.font} onChange={(e) => onChange({ font: e.target.value })}>
              {allFonts.map((f) => (
                <option key={f} value={f}>
                  {f.split(",")[0]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Peso">
            <select
              className={input}
              value={style.weight}
              onChange={(e) => onChange({ weight: e.target.value as CaptionStyle["weight"] })}
            >
              <option value="400">Regular</option>
              <option value="600">Semibold</option>
              <option value="700">Bold</option>
              <option value="800">Black</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Cor do texto", "color"],
              ["Cor do destaque", "activeColor"],
              ["Contorno", "strokeColor"],
              ["Caixa/realce", "highlightColor"],
            ] as const
          ).map(([label, key]) => (
            <Field key={key} label={label}>
              <input
                type="color"
                className="h-8 w-full rounded-lg border border-border bg-transparent"
                value={(style[key] as string | undefined) ?? "#000000"}
                onChange={(e) => onChange({ [key]: e.target.value } as Partial<CaptionStyle>)}
              />
            </Field>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Range label="Tamanho" value={style.size} min={28} max={150} onChange={(v) => onChange({ size: v })} />
          <Range label="Contorno" value={style.stroke} min={0} max={26} onChange={(v) => onChange({ stroke: v })} />
          <Range
            label="Palavras por frase"
            value={style.maxWords}
            min={1}
            max={10}
            onChange={(v) => onChange({ maxWords: v })}
          />
          <Range
            label="Linhas na tela"
            value={style.maxLines ?? 2}
            min={1}
            max={4}
            onChange={(v) => onChange({ maxLines: v })}
          />
          <Range
            label="Altura da linha"
            value={style.lineHeight ?? 1.2}
            min={0.9}
            max={2}
            step={0.05}
            onChange={(v) => onChange({ lineHeight: v })}
          />
          <Range
            label="Posição vertical"
            value={style.y}
            min={0}
            max={1800}
            step={10}
            onChange={(v) => onChange({ y: v })}
          />
          <Range
            label="Largura da caixa"
            value={style.w}
            min={300}
            max={1080}
            step={10}
            onChange={(v) => onChange({ w: v })}
          />
          <Range
            label="Opacidade"
            value={Math.round((style.opacity ?? 1) * 100)}
            min={20}
            max={100}
            suffix="%"
            onChange={(v) => onChange({ opacity: v / 100 })}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                onClick={() => onChange({ align: a })}
                className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                  style.align === a ? "border-primary text-primary" : "border-border"
                }`}
              >
                {a === "left" ? "esq" : a === "center" ? "centro" : "dir"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 font-mono text-[11px]">
            <input
              type="checkbox"
              checked={style.uppercase}
              onChange={(e) => onChange({ uppercase: e.target.checked })}
              className="size-4 accent-[var(--primary)]"
            />
            <Type className="size-3" /> MAIÚSCULAS
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-[11px] hover:border-primary">
            <Upload className="size-3" /> fonte própria
            <input
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const font = await fileToFont(f);
                onAddFont?.(font);
                setFontFiles((n) => n + 1);
                onChange({ font: font.name });
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
