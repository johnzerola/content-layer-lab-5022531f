import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  ChevronDown,
  Trash2,
  Upload,
  Undo2,
  Redo2,
  Plus,
  ArrowUp,
  ArrowDown,
  Magnet,
  Bug,

  Type as TypeIcon,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateCanvas, LAYER_ORDER, LAYER_LABELS } from "./TemplateCanvas";
import {
  defaultCaptions,
  makeExtra,
  type CaptionStyle,
  type ImageLayer,
  type LayerId,
  type SelId,
  type Template,
  type TextLayer,
} from "@/lib/template";
import { BUILTIN_FONTS, fileToFont, registerFonts } from "@/lib/fonts";

const KEY_OF: Record<LayerId, keyof Template> = {
  video: "video",
  watermark: "watermark",
  avatar: "avatar",
  name: "name_",
  handle: "handle",
  headline: "headline",
  cta: "cta",
  captions: "captions",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="mono-label">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary";

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-foreground">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--primary)]"
      />
    </div>
  );
}

async function fileToDataUrl(file: File) {
  return new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(file);
  });
}

export function TemplateEditor({
  value,
  onCancel,
  onSave,
  onUse,
}: {
  value: Template;
  onCancel: () => void;
  onSave: (t: Template) => void;
  onUse: (t: Template) => void;
}) {
  const [t, setTRaw] = useState<Template>(value);
  const [selected, setSelected] = useState<SelId | null>("headline");
  const [open, setOpen] = useState<SelId | null>("headline");
  const [snap, setSnap] = useState(true);
  const [debug, setDebug] = useState(false);
  const [debugGrid, setDebugGrid] = useState(3);
  const [debugSafe, setDebugSafe] = useState(true);
  const [debugBoxes, setDebugBoxes] = useState(true);


  const past = useRef<Template[]>([]);
  const future = useRef<Template[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    void registerFonts(value.fonts);
  }, [value.fonts]);

  const setT = useCallback((next: Template | ((cur: Template) => Template)) => {
    setTRaw((cur) => {
      const value_ = typeof next === "function" ? (next as (c: Template) => Template)(cur) : next;
      past.current = [...past.current.slice(-49), cur];
      future.current = [];
      force((n) => n + 1);
      return value_;
    });
  }, []);

  const undo = useCallback(() => {
    setTRaw((cur) => {
      const prev = past.current.pop();
      if (!prev) return cur;
      future.current = [cur, ...future.current.slice(0, 49)];
      force((n) => n + 1);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    setTRaw((cur) => {
      const [next, ...rest] = future.current;
      if (!next) return cur;
      future.current = rest;
      past.current = [...past.current, cur];
      force((n) => n + 1);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const fonts = useMemo(
    () => [...BUILTIN_FONTS, ...(t.fonts ?? []).map((f) => f.name)],
    [t.fonts],
  );

  const patch = (id: LayerId, data: Record<string, unknown>) => {
    const key = KEY_OF[id];
    const cur = (t[key] ?? (id === "captions" ? defaultCaptions() : {})) as object;
    setT({ ...t, [key]: { ...cur, ...data } } as Template);
  };

  const patchExtra = (extraId: string, data: Record<string, unknown>) =>
    setT({
      ...t,
      extras: (t.extras ?? []).map((e) => (e.id === extraId ? ({ ...e, ...data } as typeof e) : e)),
    });

  const addExtra = (kind: "text" | "image") => {
    const extra = makeExtra(kind, (t.extras ?? []).length);
    setT({ ...t, extras: [...(t.extras ?? []), extra] });
    setSelected(`extra:${extra.id}`);
    setOpen(`extra:${extra.id}`);
  };

  const removeExtra = (extraId: string) =>
    setT({ ...t, extras: (t.extras ?? []).filter((e) => e.id !== extraId) });

  const textLayer = (id: LayerId) => t[KEY_OF[id]] as unknown as TextLayer;
  const imgLayer = (id: LayerId) => t[KEY_OF[id]] as unknown as ImageLayer;
  const caps = t.captions ?? defaultCaptions();

  const uploadFont = async (f: File) => {
    const font = await fileToFont(f);
    setT({ ...t, fonts: [...(t.fonts ?? []).filter((x) => x.name !== font.name), font] });
  };

  const zOpacity = (
    layer: { z?: number; opacity?: number },
    apply: (data: Record<string, unknown>) => void,
  ) => (
    <div className="space-y-2 border-t border-border pt-2">
      <Slider
        label="Ordem (z-index)"
        value={layer.z ?? 0}
        min={0}
        max={200}
        onChange={(v) => apply({ z: v })}
      />
      <Slider
        label="Opacidade"
        value={Math.round((layer.opacity ?? 1) * 100)}
        min={0}
        max={100}
        onChange={(v) => apply({ opacity: v / 100 })}
      />
      <div className="flex gap-2">
        <button
          onClick={() => apply({ z: (layer.z ?? 0) + 10 })}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-primary"
        >
          <ArrowUp className="size-3" /> frente
        </button>
        <button
          onClick={() => apply({ z: Math.max(0, (layer.z ?? 0) - 10) })}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-primary"
        >
          <ArrowDown className="size-3" /> trás
        </button>
      </div>
    </div>
  );

  const fontSelect = (val: string, onPick: (v: string) => void) => (
    <Field label="Fonte">
      <select className={inputCls} value={val} onChange={(e) => onPick(e.target.value)}>
        {fonts.map((f) => (
          <option key={f} value={f}>
            {f.split(",")[0]}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-6">
      <div className="panel flex h-full w-full max-w-6xl flex-col overflow-hidden">
        <header className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-lg font-semibold">Personalizar template</h2>
            <p className="text-sm text-muted-foreground">
              Ajuste textos, cores e elementos. Preview atualiza em tempo real.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={undo}
              disabled={!past.current.length}
              className="rounded-md border border-border p-2 disabled:opacity-40 hover:border-primary"
              title="Desfazer (Ctrl+Z)"
            >
              <Undo2 className="size-4" />
            </button>
            <button
              onClick={redo}
              disabled={!future.current.length}
              className="rounded-md border border-border p-2 disabled:opacity-40 hover:border-primary"
              title="Refazer (Ctrl+Shift+Z)"
            >
              <Redo2 className="size-4" />
            </button>
            <button
              onClick={() => setSnap((s) => !s)}
              className={`rounded-md border p-2 ${snap ? "border-primary text-primary" : "border-border"}`}
              title="Snap e guias de alinhamento (segure Alt para ignorar)"
            >
              <Magnet className="size-4" />
            </button>
            <button
              onClick={() => setDebug((d) => !d)}
              className={`rounded-md border p-2 ${debug ? "border-primary text-primary" : "border-border"}`}
              title="Modo de depuração: grade, safe areas e bounding boxes"
            >
              <Bug className="size-4" />
            </button>
            <button onClick={onCancel} className="rounded-md p-2 hover:bg-surface-2" aria-label="Fechar">
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_400px]">
          <div className="space-y-3">
            <TemplateCanvas
              template={t}
              selected={selected}
              onSelect={setSelected}
              onChange={setT}
              snap={snap}
              debug={debug}
              debugGrid={debugGrid}
              debugSafeArea={debugSafe}
              debugBoxes={debugBoxes}
            />
            {debug ? <DebugPanel
              t={t}
              selected={selected}
              grid={debugGrid}
              setGrid={setDebugGrid}
              safe={debugSafe}
              setSafe={setDebugSafe}
              boxes={debugBoxes}
              setBoxes={setDebugBoxes}
            /> : (
              <p className="text-center text-xs text-muted-foreground">
                Arraste elementos direto no preview · guias grudam nas bordas e no centro (Alt ignora)
              </p>
            )}
          </div>


          <div className="space-y-4 lg:max-h-[62vh] lg:overflow-y-auto lg:pr-1">
            <Field label="Nome do template">
              <input className={inputCls} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
            </Field>

            <Field label="Fundo">
              <div className="flex gap-2">
                {["#ffffff", "#0a0a0a", "#101418"].map((c) => (
                  <button
                    key={c}
                    onClick={() => setT({ ...t, background: c })}
                    className={`size-9 rounded-lg border-2 ${t.background === c ? "border-primary" : "border-border"}`}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
                <input
                  type="color"
                  value={t.background}
                  onChange={(e) => setT({ ...t, background: e.target.value })}
                  className="size-9 rounded-lg border border-border bg-transparent"
                />
              </div>
            </Field>

            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="mono-label mb-2">Fontes próprias</p>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary">
                <Upload className="size-3.5" /> Enviar .ttf / .otf / .woff
                <input
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2,font/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) await uploadFont(f);
                  }}
                />
              </label>
              {(t.fonts ?? []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(t.fonts ?? []).map((f) => (
                    <span
                      key={f.name}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px]"
                    >
                      {f.name}
                      <button
                        onClick={() => setT({ ...t, fonts: (t.fonts ?? []).filter((x) => x.name !== f.name) })}
                        className="text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {LAYER_ORDER.map((id) => {
              const layer = t[KEY_OF[id]] as unknown as { visible: boolean; z?: number; opacity?: number } | undefined;
              if (!layer) return null;
              const isOpen = open === id;
              return (
                <div key={id} className="rounded-xl border border-border bg-surface-2">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      onChange={(e) => patch(id, { visible: e.target.checked })}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <button
                      className="flex flex-1 items-center justify-between text-left text-sm"
                      onClick={() => {
                        setOpen(isOpen ? null : id);
                        setSelected(id);
                      }}
                    >
                      {LAYER_LABELS[id]}
                      <ChevronDown className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="space-y-3 border-t border-border p-3">
                      {id === "video" && (
                        <>
                          <Slider label="X" value={t.video.x} min={-200} max={1080} onChange={(v) => patch(id, { x: v })} />
                          <Slider label="Y" value={t.video.y} min={-200} max={1920} onChange={(v) => patch(id, { y: v })} />
                          <Slider label="Largura" value={t.video.w} min={200} max={1080} onChange={(v) => patch(id, { w: v })} />
                          <Slider label="Altura" value={t.video.h} min={200} max={1920} onChange={(v) => patch(id, { h: v })} />
                          <Slider label="Cantos arredondados" value={t.video.radius} min={0} max={240} onChange={(v) => patch(id, { radius: v })} />
                          <div className="flex gap-2">
                            {[
                              ["9:16", 9 / 16],
                              ["4:5", 4 / 5],
                              ["1:1", 1],
                            ].map(([label, ratio]) => (
                              <button
                                key={label as string}
                                onClick={() => patch(id, { h: Math.round(t.video.w / (ratio as number)) })}
                                className="rounded-md border border-border px-2.5 py-1 font-mono text-xs hover:border-primary"
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}

                      {id === "captions" && (
                        <>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            As legendas são geradas por vídeo na tela principal. Aqui você define o estilo.
                          </p>
                          <Field label="Estilo">
                            <select
                              className={inputCls}
                              value={caps.mode}
                              onChange={(e) => patch(id, { mode: e.target.value as CaptionStyle["mode"] })}
                            >
                              <option value="karaoke">Karaokê (destaca a palavra falada)</option>
                              <option value="word">Uma palavra por vez</option>
                              <option value="line">Linha inteira</option>
                            </select>
                          </Field>
                          {fontSelect(caps.font, (v) => patch(id, { font: v }))}
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Cor">
                              <input
                                type="color"
                                className="h-9 w-full rounded-lg border border-border bg-transparent"
                                value={caps.color}
                                onChange={(e) => patch(id, { color: e.target.value })}
                              />
                            </Field>
                            <Field label="Cor do destaque">
                              <input
                                type="color"
                                className="h-9 w-full rounded-lg border border-border bg-transparent"
                                value={caps.activeColor}
                                onChange={(e) => patch(id, { activeColor: e.target.value })}
                              />
                            </Field>
                          </div>
                          <Slider label="Tamanho" value={caps.size} min={28} max={140} onChange={(v) => patch(id, { size: v })} />
                          <Slider label="Contorno" value={caps.stroke} min={0} max={24} onChange={(v) => patch(id, { stroke: v })} />
                          <Slider label="Palavras por bloco" value={caps.maxWords} min={1} max={8} onChange={(v) => patch(id, { maxWords: v })} />
                          <Slider label="X" value={caps.x} min={0} max={1080} onChange={(v) => patch(id, { x: v })} />
                          <Slider label="Y" value={caps.y} min={0} max={1920} onChange={(v) => patch(id, { y: v })} />
                          <Slider label="Largura" value={caps.w} min={200} max={1080} onChange={(v) => patch(id, { w: v })} />
                          <Field label="Fundo">
                            <select
                              className={inputCls}
                              value={caps.bg}
                              onChange={(e) => patch(id, { bg: e.target.value as CaptionStyle["bg"] })}
                            >
                              <option value="shadow">Sombra</option>
                              <option value="box">Caixa</option>
                              <option value="none">Nenhum</option>
                            </select>
                          </Field>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={caps.uppercase}
                              onChange={(e) => patch(id, { uppercase: e.target.checked })}
                              className="size-4 accent-[var(--primary)]"
                            />
                            MAIÚSCULAS
                          </label>
                        </>
                      )}

                      {(id === "avatar" || id === "watermark") && (
                        <>
                          <div className="flex items-center gap-2">
                            {imgLayer(id).src && (
                              <img src={imgLayer(id).src!} alt="" className="size-10 rounded-md object-cover" />
                            )}
                            <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary">
                              <Upload className="size-3.5" /> Trocar imagem
                              <input
                                type="file"
                                accept="image/*"
                                hidden
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  if (f) patch(id, { src: await fileToDataUrl(f), visible: true });
                                }}
                              />
                            </label>
                            {imgLayer(id).src && (
                              <button
                                onClick={() => patch(id, { src: null })}
                                className="rounded-lg border border-border p-2 text-destructive hover:border-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                          <Slider label="X" value={imgLayer(id).x} min={-100} max={1080} onChange={(v) => patch(id, { x: v })} />
                          <Slider label="Y" value={imgLayer(id).y} min={-100} max={1920} onChange={(v) => patch(id, { y: v })} />
                          <Slider
                            label="Tamanho"
                            value={imgLayer(id).w}
                            min={40}
                            max={900}
                            onChange={(v) => patch(id, { w: v, h: v })}
                          />
                          <Slider
                            label="Opacidade"
                            value={Math.round(imgLayer(id).opacity * 100)}
                            min={0}
                            max={100}
                            onChange={(v) => patch(id, { opacity: v / 100 })}
                          />
                          <Slider
                            label="Rotação"
                            value={imgLayer(id).rotation}
                            min={-45}
                            max={45}
                            onChange={(v) => patch(id, { rotation: v })}
                          />
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={imgLayer(id).round}
                              onChange={(e) => patch(id, { round: e.target.checked })}
                              className="size-4 accent-[var(--primary)]"
                            />
                            Recorte circular
                          </label>
                        </>
                      )}

                      {["name", "handle", "headline", "cta"].includes(id) && (
                        <>
                          <Field label="Texto">
                            <textarea
                              className={inputCls}
                              rows={id === "headline" ? 2 : 1}
                              value={textLayer(id).text}
                              onChange={(e) => patch(id, { text: e.target.value })}
                            />
                          </Field>
                          {fontSelect(textLayer(id).font, (v) => patch(id, { font: v }))}
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Cor">
                              <input
                                type="color"
                                className="h-9 w-full rounded-lg border border-border bg-transparent"
                                value={textLayer(id).color}
                                onChange={(e) => patch(id, { color: e.target.value })}
                              />
                            </Field>
                            <Field label="Tamanho">
                              <input
                                type="number"
                                className={inputCls}
                                value={textLayer(id).size}
                                onChange={(e) => patch(id, { size: Number(e.target.value) })}
                              />
                            </Field>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Peso">
                              <select
                                className={inputCls}
                                value={textLayer(id).weight}
                                onChange={(e) => patch(id, { weight: e.target.value })}
                              >
                                <option value="400">Regular</option>
                                <option value="600">Semibold</option>
                                <option value="700">Bold</option>
                                <option value="800">Black</option>
                              </select>
                            </Field>
                            <Field label="Alinhamento">
                              <select
                                className={inputCls}
                                value={textLayer(id).align}
                                onChange={(e) => patch(id, { align: e.target.value })}
                              >
                                <option value="left">Esquerda</option>
                                <option value="center">Centro</option>
                                <option value="right">Direita</option>
                              </select>
                            </Field>
                          </div>
                          <Slider label="X" value={textLayer(id).x} min={-100} max={1080} onChange={(v) => patch(id, { x: v })} />
                          <Slider label="Y" value={textLayer(id).y} min={-100} max={1920} onChange={(v) => patch(id, { y: v })} />
                          <Slider label="Largura da caixa" value={textLayer(id).w} min={100} max={1080} onChange={(v) => patch(id, { w: v })} />
                          <Slider label="Rotação" value={textLayer(id).rotation} min={-45} max={45} onChange={(v) => patch(id, { rotation: v })} />

                          {id === "name" && (
                            <>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={!!textLayer(id).badge}
                                  onChange={(e) => patch(id, { badge: e.target.checked })}
                                  className="size-4 accent-[var(--primary)]"
                                />
                                Mostrar selo azul verificado
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={!!textLayer(id).accentColor}
                                  onChange={(e) =>
                                    patch(id, {
                                      accentColor: e.target.checked ? "#d75904" : undefined,
                                      accentFrom: 0,
                                      accentTo: textLayer(id).text.length,
                                    })
                                  }
                                  className="size-4 accent-[var(--primary)]"
                                />
                                Colorir parte do nome
                              </label>
                              {textLayer(id).accentColor && (
                                <div className="space-y-2">
                                  <Slider
                                    label="Início"
                                    value={textLayer(id).accentFrom ?? 0}
                                    min={0}
                                    max={textLayer(id).text.length}
                                    onChange={(v) => patch(id, { accentFrom: v })}
                                  />
                                  <Slider
                                    label="Fim"
                                    value={textLayer(id).accentTo ?? 0}
                                    min={0}
                                    max={textLayer(id).text.length}
                                    onChange={(v) => patch(id, { accentTo: v })}
                                  />
                                  <input
                                    type="color"
                                    value={textLayer(id).accentColor}
                                    onChange={(e) => patch(id, { accentColor: e.target.value })}
                                    className="h-9 w-full rounded-lg border border-border bg-transparent"
                                  />
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}

                      {zOpacity(layer, (data) => patch(id, data))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* camadas livres */}
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <p className="mono-label">Camadas livres</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => addExtra("text")}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-primary"
                  >
                    <Plus className="size-3" />
                    <TypeIcon className="size-3" /> texto
                  </button>
                  <button
                    onClick={() => addExtra("image")}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-primary"
                  >
                    <Plus className="size-3" />
                    <ImageIcon className="size-3" /> imagem
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {(t.extras ?? []).length === 0 && (
                  <p className="font-mono text-[11px] text-muted-foreground">
                    nenhuma ainda — adicione textos ou imagens extras
                  </p>
                )}
                {(t.extras ?? []).map((e) => {
                  const sel = open === `extra:${e.id}`;
                  const isImg = "src" in e;
                  return (
                    <div key={e.id} className="rounded-lg border border-border bg-background">
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <input
                          type="checkbox"
                          checked={e.visible}
                          onChange={(ev) => patchExtra(e.id, { visible: ev.target.checked })}
                          className="size-4 accent-[var(--primary)]"
                        />
                        <button
                          className="flex-1 text-left text-sm"
                          onClick={() => {
                            setOpen(sel ? null : `extra:${e.id}`);
                            setSelected(`extra:${e.id}`);
                          }}
                        >
                          {e.label}
                        </button>
                        <button onClick={() => removeExtra(e.id)} className="text-destructive">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      {sel && (
                        <div className="space-y-3 border-t border-border p-3">
                          <Field label="Nome da camada">
                            <input
                              className={inputCls}
                              value={e.label}
                              onChange={(ev) => patchExtra(e.id, { label: ev.target.value })}
                            />
                          </Field>
                          {isImg ? (
                            <>
                              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-primary">
                                <Upload className="size-3.5" /> Enviar imagem
                                <input
                                  type="file"
                                  accept="image/*"
                                  hidden
                                  onChange={async (ev) => {
                                    const f = ev.target.files?.[0];
                                    if (f) patchExtra(e.id, { src: await fileToDataUrl(f) });
                                  }}
                                />
                              </label>
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={(e as ImageLayer).round}
                                  onChange={(ev) => patchExtra(e.id, { round: ev.target.checked })}
                                  className="size-4 accent-[var(--primary)]"
                                />
                                Recorte circular
                              </label>
                            </>
                          ) : (
                            <>
                              <Field label="Texto">
                                <textarea
                                  className={inputCls}
                                  rows={2}
                                  value={(e as TextLayer).text}
                                  onChange={(ev) => patchExtra(e.id, { text: ev.target.value })}
                                />
                              </Field>
                              {fontSelect((e as TextLayer).font, (v) => patchExtra(e.id, { font: v }))}
                              <div className="grid grid-cols-2 gap-3">
                                <Field label="Cor">
                                  <input
                                    type="color"
                                    className="h-9 w-full rounded-lg border border-border bg-transparent"
                                    value={(e as TextLayer).color}
                                    onChange={(ev) => patchExtra(e.id, { color: ev.target.value })}
                                  />
                                </Field>
                                <Field label="Tamanho">
                                  <input
                                    type="number"
                                    className={inputCls}
                                    value={(e as TextLayer).size}
                                    onChange={(ev) => patchExtra(e.id, { size: Number(ev.target.value) })}
                                  />
                                </Field>
                              </div>
                            </>
                          )}
                          <Slider label="X" value={e.x} min={-200} max={1080} onChange={(v) => patchExtra(e.id, { x: v })} />
                          <Slider label="Y" value={e.y} min={-200} max={1920} onChange={(v) => patchExtra(e.id, { y: v })} />
                          <Slider label="Largura" value={e.w} min={40} max={1080} onChange={(v) => patchExtra(e.id, { w: v })} />
                          <Slider label="Altura" value={e.h} min={40} max={1920} onChange={(v) => patchExtra(e.id, { h: v })} />
                          <Slider label="Rotação" value={e.rotation} min={-45} max={45} onChange={(v) => patchExtra(e.id, { rotation: v })} />
                          {zOpacity(e, (data) => patchExtra(e.id, data))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="mono-label mb-2">Anti-duplicidade</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={t.mirror}
                  onChange={(e) => setT({ ...t, mirror: e.target.checked })}
                  className="size-4 accent-[var(--primary)]"
                />
                Espelhar vídeo horizontalmente
              </label>
              <div className="mt-3">
                <Slider
                  label="Velocidade"
                  value={t.speed}
                  min={0.95}
                  max={1.05}
                  step={0.01}
                  onChange={(v) => setT({ ...t, speed: v })}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Muda a duração e o fingerprint do arquivo. Não há garantia de que plataformas tratem o vídeo como novo.
              </p>
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="outline" onClick={() => onUse(t)}>
            Usar sem salvar
          </Button>
          <Button onClick={() => onSave(t)}>Salvar e usar</Button>
        </footer>
      </div>
    </div>
  );
}
