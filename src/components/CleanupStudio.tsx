import { useCallback, useRef, useState } from "react";
import { Eraser, Plus, ScanSearch, Trash2 } from "lucide-react";
import { CLEANUP_PRESETS, makeCleanupRegion, type CleanupRegion } from "@/lib/template";

type Props = {
  regions: CleanupRegion[];
  onChange: (regions: CleanupRegion[]) => void;
  /** quadro do vídeo original para desenhar as máscaras por cima */
  poster?: string | undefined;
  /** proporção da área do vídeo (largura / altura) */
  aspect?: number;
  /** dispara a detecção automática de legenda/marca d'água */
  onDetect?: () => void;
  detecting?: boolean;
  detectMsg?: string | undefined;
  /** true quando as áreas pertencem ao vídeo selecionado (LimpaVídeo) */
  perVideo?: boolean;
  /** copia estas áreas para todos os vídeos da fila */
  onApplyAll?: (() => void) | undefined;
  /** adiciona as zonas típicas (rodapé de legenda / canto da marca d'água) */
  onUseSafeZones?: () => void;
  /** áreas encontradas pela detecção, ainda não aplicadas */
  suggestions?: CleanupRegion[];
  onUseSuggestion?: (r: CleanupRegion) => void;
  onUseAllSuggestions?: () => void;
  onClearSuggestions?: () => void;
};


type Drag =
  | { kind: "new"; x0: number; y0: number; id: string }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "resize"; id: string };

const MODES: { id: CleanupRegion["mode"]; label: string }[] = [
  { id: "inpaint", label: "Reconstruir (sem borrão)" },
  { id: "smear", label: "Clonar vizinho" },
  { id: "blur", label: "Borrão" },
  { id: "pixelate", label: "Mosaico" },
  { id: "solid", label: "Tarja" },
];

const FROM: { id: NonNullable<CleanupRegion["from"]>; label: string }[] = [
  { id: "top", label: "de cima" },
  { id: "bottom", label: "de baixo" },
  { id: "left", label: "da esquerda" },
  { id: "right", label: "da direita" },
];

export function CleanupStudio({
  regions,
  onChange,
  poster,
  aspect = 9 / 16,
  onDetect,
  detecting,
  detectMsg,
  perVideo = false,
  onApplyAll,
  onUseSafeZones,
  suggestions = [],
  onUseSuggestion,
  onUseAllSuggestions,
  onClearSuggestions,
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [sel, setSel] = useState<string | null>(regions[0]?.id ?? null);

  const patch = useCallback(
    (id: string, p: Partial<CleanupRegion>) =>
      onChange(regions.map((r) => (r.id === id ? { ...r, ...p } : r))),
    [regions, onChange],
  );

  const point = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return { x: 0, y: 0 };
    const b = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
      y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    const p = point(e);
    const region = makeCleanupRegion({ label: `Área ${regions.length + 1}`, x: p.x, y: p.y, w: 0.001, h: 0.001 });
    onChange([...regions, region]);
    setSel(region.id);
    setDrag({ kind: "new", x0: p.x, y0: p.y, id: region.id });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = point(e);
    if (drag.kind === "new") {
      patch(drag.id, {
        x: Math.min(drag.x0, p.x),
        y: Math.min(drag.y0, p.y),
        w: Math.abs(p.x - drag.x0),
        h: Math.abs(p.y - drag.y0),
      });
    } else if (drag.kind === "move") {
      const r = regions.find((x) => x.id === drag.id);
      if (!r) return;
      patch(drag.id, {
        x: Math.min(1 - r.w, Math.max(0, p.x - drag.dx)),
        y: Math.min(1 - r.h, Math.max(0, p.y - drag.dy)),
      });
    } else {
      const r = regions.find((x) => x.id === drag.id);
      if (!r) return;
      patch(drag.id, { w: Math.max(0.02, p.x - r.x), h: Math.max(0.02, p.y - r.y) });
    }
  };

  const onUp = () => {
    if (drag?.kind === "new") {
      const r = regions.find((x) => x.id === drag.id);
      if (r && (r.w < 0.02 || r.h < 0.02)) onChange(regions.filter((x) => x.id !== drag.id));
    }
    setDrag(null);
  };

  const active = regions.find((r) => r.id === sel) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="mono-label flex items-center gap-1.5">
          <Eraser className="size-3.5" /> Remover legenda / marca d'água / texto
          {perVideo && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] text-primary">
              áreas deste vídeo · {regions.length}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {onDetect && (
            <button
              type="button"
              disabled={detecting}
              onClick={onDetect}
              className="flex items-center gap-1 rounded-md border border-primary/50 bg-primary/10 px-2 py-1 font-mono text-[10px] text-primary disabled:opacity-60"
            >
              <ScanSearch className="size-3" /> {detecting ? "analisando…" : "re-analisar"}
            </button>
          )}
          {onApplyAll && (
            <button
              type="button"
              onClick={onApplyAll}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary/60 hover:text-foreground"
            >
              <CopyCheck className="size-3" /> aplicar em todos
            </button>
          )}
          {onUseSafeZones && (
            <button
              type="button"
              onClick={onUseSafeZones}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary/60 hover:text-foreground"
            >
              zonas típicas
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const r = makeCleanupRegion({ label: `Área ${regions.length + 1}` });
              onChange([...regions, r]);
              setSel(r.id);
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            <Plus className="size-3" /> nova área
          </button>
        </div>
      </div>

      {perVideo && (
        <p className="font-mono text-[10px] text-muted-foreground">
          a análise roda sozinha ao importar: cada vídeo recebe suas próprias áreas e elas já entram no
          processamento em lote.
        </p>
      )}


      {(detectMsg || suggestions.length > 0) && (
        <div className="rounded-lg border border-warn/50 bg-warn/10 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-[10px] text-warn">
              {detectMsg ?? `${suggestions.length} área(s) encontrada(s)`}
            </p>
            {suggestions.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onUseAllSuggestions}
                  className="rounded border border-primary/60 bg-primary/15 px-2 py-0.5 font-mono text-[10px] text-primary"
                >
                  usar todas
                </button>
                <button
                  type="button"
                  onClick={onClearSuggestions}
                  className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  descartar
                </button>
              </div>
            )}
          </div>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onUseSuggestion?.(s)}
                  className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-foreground hover:border-primary/60"
                >
                  + {s.label} · {Math.round(s.w * 100)}×{Math.round(s.h * 100)}%
                </button>
              ))}
            </div>
          )}
        </div>
      )}


      <div className="flex flex-wrap gap-1">
        {CLEANUP_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              const r = makeCleanupRegion(p.region);
              onChange([...regions, r]);
              setSel(r.id);
            }}
            className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary/60 hover:text-foreground"
          >
            + {p.label}
          </button>
        ))}
      </div>

      <div
        ref={boxRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="relative w-full cursor-crosshair overflow-hidden rounded-xl border border-border bg-surface-2 select-none"
        style={{ aspectRatio: String(aspect) }}
      >
        {poster ? (
          <img
            src={poster}
            alt="quadro original para marcar áreas"
            className="pointer-events-none absolute inset-0 size-full object-cover opacity-90"
          />
        ) : (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] text-muted-foreground">
            selecione um vídeo para ver o quadro
          </div>
        )}
        {suggestions.map((s) => (
          <div
            key={s.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              onUseSuggestion?.(s);
            }}
            className="absolute cursor-copy border-2 border-dashed border-warn bg-warn/15"
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, height: `${s.h * 100}%` }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-warn px-1 font-mono text-[9px] text-background">
              {s.label} · clique para usar
            </span>
          </div>
        ))}
        {regions.map((r) => (
          <div
            key={r.id}
            onPointerDown={(e) => {
              e.stopPropagation();
              const p = point(e);
              setSel(r.id);
              setDrag({ kind: "move", id: r.id, dx: p.x - r.x, dy: p.y - r.y });
              boxRef.current?.setPointerCapture(e.pointerId);
            }}
            className={`absolute cursor-move border-2 ${
              r.id === sel ? "border-primary bg-primary/25" : "border-white/70 bg-white/10"
            } ${r.enabled ? "" : "opacity-40"}`}
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-background/80 px-1 font-mono text-[9px] text-foreground">
              {r.label}
            </span>
            <span
              onPointerDown={(e) => {
                e.stopPropagation();
                setSel(r.id);
                setDrag({ kind: "resize", id: r.id });
                boxRef.current?.setPointerCapture(e.pointerId);
              }}
              className="absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm bg-primary"
            />
          </div>
        ))}
      </div>
      <p className="font-mono text-[10px] text-muted-foreground">
        arraste sobre o quadro para marcar a área a apagar · aplicado no preview e no arquivo exportado
      </p>

      {regions.length > 0 && (
        <div className="space-y-2">
          {regions.map((r) => (
            <div
              key={r.id}
              onClick={() => setSel(r.id)}
              className={`rounded-lg border p-2 ${r.id === sel ? "border-primary/60 bg-primary/5" : "border-border"}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => patch(r.id, { enabled: e.target.checked })}
                  className="size-4 accent-[var(--primary)]"
                />
                <input
                  value={r.label}
                  onChange={(e) => patch(r.id, { label: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 font-mono text-[11px]"
                />
                <select
                  value={r.mode}
                  onChange={(e) => patch(r.id, { mode: e.target.value as CleanupRegion["mode"] })}
                  className="rounded border border-border bg-background px-1 py-1 font-mono text-[10px]"
                >
                  {MODES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onChange(regions.filter((x) => x.id !== r.id))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              {r.id === sel && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {r.mode !== "solid" && (
                    <label className="font-mono text-[10px] text-muted-foreground">
                      intensidade · {r.strength}
                      <input
                        type="range"
                        min={5}
                        max={100}
                        value={r.strength}
                        onChange={(e) => patch(r.id, { strength: Number(e.target.value) })}
                        className="w-full accent-[var(--primary)]"
                      />
                    </label>
                  )}
                  {r.mode === "smear" && (
                    <label className="font-mono text-[10px] text-muted-foreground">
                      copiar pixels
                      <select
                        value={r.from ?? "top"}
                        onChange={(e) => patch(r.id, { from: e.target.value as NonNullable<CleanupRegion["from"]> })}
                        className="mt-1 w-full rounded border border-border bg-background px-2 py-1"
                      >
                        {FROM.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {r.mode === "solid" && (
                    <label className="font-mono text-[10px] text-muted-foreground">
                      cor da tarja
                      <input
                        type="color"
                        value={r.color ?? "#000000"}
                        onChange={(e) => patch(r.id, { color: e.target.value })}
                        className="mt-1 h-8 w-full rounded border border-border bg-background"
                      />
                    </label>
                  )}
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <label key={k} className="font-mono text-[10px] text-muted-foreground">
                      {k === "x" ? "esquerda" : k === "y" ? "topo" : k === "w" ? "largura" : "altura"} ·{" "}
                      {Math.round(r[k] * 100)}%
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(r[k] * 100)}
                        onChange={(e) => patch(r.id, { [k]: Number(e.target.value) / 100 } as Partial<CleanupRegion>)}
                        className="w-full accent-[var(--primary)]"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
