import { useEffect, useMemo, useRef, useState } from "react";
import {
  Scissors,
  Play,
  Pause,
  StopCircle,
  Download,
  FileArchive,
  FolderDown,
  X,
  Sliders,
  Check,
  Flame,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/clips";

export interface ClipItem {
  id: string;
  file: File;
  poster: string | null;
  duration: number;
  clip?: { start: number; end: number } | undefined;
  score?: number | undefined;
  clipTitle?: string | undefined;
  clipReason?: string | undefined;
  clipTags?: string[] | undefined;
  status: "pendente" | "na fila" | "processando" | "pronto" | "erro";
  progress: number;
  blob?: Blob | undefined;
  ext?: string | undefined;
}

export interface ClipSettings {
  minLen: number;
  maxLen: number;
  max: number;
  minScore: number;
}

interface Props {
  sources: ClipItem[];
  clips: ClipItem[];
  settings: ClipSettings;
  onSettings: (patch: Partial<ClipSettings>) => void;
  clipBusy: boolean;
  /** 0..1 — progresso da análise */
  clipProgress?: number;
  /** última falha da análise, mostrada na tela */
  clipError?: string | null;
  onGenerate: (item: ClipItem) => void;
  running: boolean;
  paused: boolean;
  zipping: boolean;
  eta: string | null;
  readyCount: number;
  fsAccess: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onProcess: (ids?: string[]) => void;
  onTogglePause: () => void;
  onCancel: () => void;
  onRemove: (id: string) => void;
  onDownload: (item: ClipItem) => void;
  onZip: () => void;
  onSaveFolder: () => void;
}

const LENGTH_PRESETS = [
  { id: "curto", label: "< 30s", min: 10, max: 30 },
  { id: "medio", label: "30–60s", min: 30, max: 60 },
  { id: "longo", label: "60–90s", min: 60, max: 90 },
  { id: "xl", label: "90s–2min", min: 90, max: 120 },
  { id: "auto", label: "Automático", min: 15, max: 75 },
] as const;

function scoreTone(score: number) {
  if (score >= 85) return { label: "altíssimo", cls: "text-primary border-primary/50 bg-primary/10" };
  if (score >= 70) return { label: "alto", cls: "text-primary border-primary/30 bg-primary/5" };
  if (score >= 60) return { label: "médio", cls: "text-warn border-warn/40 bg-warn/10" };
  return { label: "baixo", cls: "text-muted-foreground border-border bg-surface-2" };
}

function ScoreBadge({ score }: { score: number }) {
  const tone = scoreTone(score);
  return (
    <div className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${tone.cls}`}>
      <Flame className="size-3" />
      {score} · {tone.label}
    </div>
  );
}

function ClipCard({
  item,
  index,
  checked,
  active,
  onToggle,
  onSelect,
  onEdit,
  onRemove,
  onDownload,
}: {
  item: ClipItem;
  index: number;
  checked: boolean;
  active: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDownload: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const url = useMemo(() => URL.createObjectURL(item.file), [item.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const start = item.clip?.start ?? 0;
  const end = item.clip?.end ?? item.duration;

  const play = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
      return;
    }
    v.currentTime = start;
    void v.play();
    setPlaying(true);
  };

  const [pos, setPos] = useState(0);
  const len = Math.max(0.1, end - start);

  return (
    <div
      onClick={onSelect}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-surface-2 transition ${
        active ? "border-primary" : "border-border hover:border-primary/40"
      }`}
    >
      <div className="relative aspect-[9/16] bg-black">
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          poster={item.poster ?? undefined}
          className="size-full object-cover"
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            setPos(Math.max(0, Math.min(len, v.currentTime - start)));
            if (v.currentTime >= end) {
              v.pause();
              v.currentTime = start;
              setPlaying(false);
              setPos(0);
            }
          }}
        />

        {/* faixa de título estilo capa de corte */}
        {item.clipTitle && (
          <div className="absolute inset-x-0 top-0 flex justify-center p-2">
            <span className="max-w-full truncate rounded-full bg-destructive px-3 py-1 text-center text-[10px] font-bold uppercase tracking-wide text-white shadow-lg">
              {item.clipTitle.replace(/ · #\d+$/, "")}
            </span>
          </div>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            play();
          }}
          className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100"
        >
          <span className="grid size-12 place-items-center rounded-full bg-background/80 backdrop-blur">
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </span>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`absolute left-2 top-2 grid size-6 place-items-center rounded-md border backdrop-blur ${
            checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/70"
          }`}
        >
          {checked && <Check className="size-3.5" />}
        </button>

        {/* score grande no canto, como no OpusClip */}
        {typeof item.score === "number" && (
          <div className="absolute bottom-12 right-2 rounded-lg bg-primary px-2.5 py-1 text-lg font-extrabold leading-none text-primary-foreground shadow-lg">
            {(item.score / 10).toFixed(1)}
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-6">
          <div className="h-1 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full bg-white"
              style={{ width: `${(item.status === "processando" ? item.progress : pos / len) * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] text-white/85">
              {formatTime(pos)} / {formatTime(len)}
            </p>
            <p
              className={`font-mono text-[10px] ${
                item.status === "pronto"
                  ? "text-primary"
                  : item.status === "erro"
                    ? "text-destructive"
                    : item.status === "processando"
                      ? "text-warn"
                      : "text-white/60"
              }`}
            >
              ● {item.status}
              {item.status === "processando" ? ` ${Math.round(item.progress * 100)}%` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* barra de ações */}
      <div className="flex items-center justify-between gap-1 border-b border-border px-2 py-1.5 text-muted-foreground">
        <span className="font-mono text-[10px]">#{index + 1}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              play();
            }}
            className="rounded-md p-1.5 hover:text-foreground"
            title="pré-visualizar"
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
              onEdit();
            }}
            className="rounded-md p-1.5 hover:text-foreground"
            title="abrir no editor"
          >
            <Scissors className="size-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded-md p-1.5 hover:text-destructive"
            title="remover corte"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* título + descrição + baixar, no modelo da referência */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">
            {item.clipTitle?.replace(/ · #\d+$/, "") ?? item.file.name}
          </p>
          {typeof item.score === "number" && <ScoreBadge score={item.score} />}
        </div>
        {item.clipReason && (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground" title={item.clipReason}>
            {item.clipReason}
          </p>
        )}
        {item.clipTags && item.clipTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.clipTags.map((t) => (
              <span key={t} className="rounded-full border border-border px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-auto space-y-1 pt-1">
          <Button
            className="w-full"
            disabled={!item.blob}
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
          >
            <Download className="size-4" /> Baixar clipe
          </Button>
          <p className="text-center text-[10px] text-muted-foreground">
            {item.blob ? "salve no seu celular ou computador" : "exporte o corte para liberar o download"}
          </p>
        </div>
      </div>
    </div>
  );
}


function SelectedClip({
  item,
  index,
  onUnpick,
  onRemove,
  onSelect,
  active,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dragging,
  dragOver,
}: {
  item: ClipItem;
  index: number;
  onUnpick: () => void;
  onRemove: () => void;
  onSelect: () => void;
  active: boolean;
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  dragging: boolean;
  dragOver: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const url = useMemo(() => URL.createObjectURL(item.file), [item.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const start = item.clip?.start ?? 0;
  const end = item.clip?.end ?? item.duration;

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
      return;
    }
    if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
    void v.play();
    setPlaying(true);
  };

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={`group relative w-36 shrink-0 cursor-move overflow-hidden rounded-lg border bg-surface-2 transition ${
        active ? "border-primary" : "border-border hover:border-primary/40"
      } ${dragging ? "opacity-40" : "opacity-100"} ${
        dragOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
    >
      <div className="absolute left-0 top-0 z-10 rounded-br-md bg-background/80 p-1 backdrop-blur">
        <GripVertical className="size-3.5 text-muted-foreground" />
      </div>
      <div className="relative aspect-[9/16] bg-black">
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          poster={item.poster ?? undefined}
          className="size-full object-cover"
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.currentTime >= end) {
              v.pause();
              v.currentTime = start;
              setPlaying(false);
            }
          }}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className="absolute inset-0 grid place-items-center"
        >
          <span className="grid size-9 place-items-center rounded-full bg-background/75 backdrop-blur">
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </span>
        </button>
        <span className="absolute left-1.5 top-1.5 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] backdrop-blur">
          #{index + 1}
        </span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-1.5">
          <p className="font-mono text-[10px] text-white/90">
            {formatTime(start)} – {formatTime(end)}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnpick();
          }}
          className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
        >
          tirar
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded p-1 text-muted-foreground hover:text-destructive"
          title="remover clipe"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ClipStudio(props: Props) {
  const {
    sources,
    clips,
    settings,
    onSettings,
    clipBusy,
    clipProgress = 0,
    clipError,
    onGenerate,
    running,
    paused,
    zipping,
    eta,
    readyCount,
    fsAccess,
    selectedId,
    onSelect,
    onEdit,
    onProcess,
    onTogglePause,
    onCancel,
    onRemove,
    onDownload,
    onZip,
    onSaveFolder,
  } = props;

  const [advanced, setAdvanced] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const source = sources.find((s) => s.id === sourceId) ?? sources[0] ?? null;
  const validPicked = picked.filter((id) => clips.some((c) => c.id === id));
  const targets = validPicked.length ? validPicked : clips.map((c) => c.id);

  const activePreset = LENGTH_PRESETS.find((p) => p.min === settings.minLen && p.max === settings.maxLen);
  const ordered = [...clips].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mono-label">Estúdio de cortes</p>
            <p className="text-lg font-semibold">
              {source ? source.file.name : "Importe um vídeo longo para começar"}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {source && source.duration
                ? `${formatTime(source.duration)} de vídeo · a IA analisa áudio e movimento`
                : "podcast, live, aula, entrevista — a IA acha os melhores trechos"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {sources.length > 1 && (
              <select
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                value={source?.id ?? ""}
                onChange={(e) => setSourceId(e.target.value)}
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.file.name}
                  </option>
                ))}
              </select>
            )}
            <Button variant="outline" onClick={() => setAdvanced((v) => !v)}>
              <Sliders className="size-4" /> Avançado
            </Button>
            <Button disabled={!source || clipBusy} onClick={() => source && onGenerate(source)}>
              <Scissors className="size-4" />{" "}
              {clipBusy
                ? `Analisando… ${Math.round(clipProgress * 100)}%`
                : clips.length
                  ? "Gerar clipes de novo"
                  : "Gerar clipes"}
            </Button>
          </div>
        </div>

        {clipBusy && (
          <div className="mt-4 space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-primary transition-[width] duration-300"
                style={{ width: `${Math.max(4, clipProgress * 100)}%` }}
              />
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              analisando áudio, silêncios e movimento · {Math.round(clipProgress * 100)}%
            </p>
          </div>
        )}

        {!clipBusy && clipError && (
          <div className="mt-4 rounded-xl border border-destructive/50 bg-destructive/10 p-3">
            <p className="font-mono text-[11px] text-destructive">{clipError}</p>
          </div>
        )}

        {!source && (
          <div className="mt-4 rounded-xl border border-border bg-surface-2 p-3">
            <p className="font-mono text-[11px] text-muted-foreground">
              importe um vídeo acima para liberar o botão de gerar clipes.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mono-label mr-1">duração do clipe</span>
          {LENGTH_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => onSettings({ minLen: p.min, maxLen: p.max })}
              className={`rounded-full border px-3 py-1 font-mono text-[11px] transition ${
                activePreset?.id === p.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {advanced && (
          <div className="mt-4 grid gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:grid-cols-2">
            <label className="font-mono text-[11px] text-muted-foreground">
              duração mínima · {settings.minLen}s
              <input
                type="range"
                min={5}
                max={180}
                step={5}
                value={settings.minLen}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onSettings({ minLen: v, ...(v > settings.maxLen ? { maxLen: v } : {}) });
                }}
                className="w-full accent-[var(--primary)]"
              />
            </label>
            <label className="font-mono text-[11px] text-muted-foreground">
              duração máxima · {settings.maxLen}s
              <input
                type="range"
                min={5}
                max={180}
                step={5}
                value={settings.maxLen}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  onSettings({ maxLen: v, ...(v < settings.minLen ? { minLen: v } : {}) });
                }}
                className="w-full accent-[var(--primary)]"
              />
            </label>
            <label className="font-mono text-[11px] text-muted-foreground">
              quantidade de clipes · até {settings.max}
              <input
                type="range"
                min={1}
                max={20}
                value={settings.max}
                onChange={(e) => onSettings({ max: Number(e.target.value) })}
                className="w-full accent-[var(--primary)]"
              />
            </label>
            <label className="font-mono text-[11px] text-muted-foreground">
              intensidade do score · {settings.minScore}
              <input
                type="range"
                min={0}
                max={95}
                step={5}
                value={settings.minScore}
                onChange={(e) => onSettings({ minScore: Number(e.target.value) })}
                className="w-full accent-[var(--primary)]"
              />
              <span className="block text-[10px] opacity-70">
                {settings.minScore >= 80
                  ? "só os trechos mais fortes"
                  : settings.minScore >= 60
                    ? "equilibrado"
                    : "aceita quase tudo"}
              </span>
            </label>
          </div>
        )}
      </section>

      {clips.length > 0 && (
        <section className="panel space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{clips.length} clipes encontrados</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                ordenados por potencial · {validPicked.length ? `${validPicked.length} selecionados` : "todos serão exportados"}
                {eta ? ` · restam ~${eta}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setPicked(validPicked.length === clips.length ? [] : clips.map((c) => c.id))}
              >
                {validPicked.length === clips.length ? "limpar seleção" : "selecionar todos"}
              </button>
              <Button onClick={() => onProcess(targets)} disabled={running || !targets.length}>
                <Play className="size-4" /> {running ? "Exportando…" : `Exportar (${targets.length})`}
              </Button>
              {running && (
                <>
                  <Button variant="outline" onClick={onTogglePause}>
                    <Pause className="size-4" /> {paused ? "Retomar" : "Pausar"}
                  </Button>
                  <Button variant="outline" onClick={onCancel}>
                    <StopCircle className="size-4" /> Cancelar
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={onZip} disabled={readyCount === 0 || zipping}>
                <FileArchive className="size-4" /> {zipping ? "Compactando…" : `ZIP (${readyCount})`}
              </Button>
              {fsAccess && (
                <Button variant="outline" onClick={onSaveFolder} disabled={readyCount === 0}>
                  <FolderDown className="size-4" /> Pasta
                </Button>
              )}
            </div>
          </div>

          {validPicked.length > 0 && (
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="mono-label">selecionados para exportar · {validPicked.length}</p>
                <button
                  className="font-mono text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setPicked([])}
                >
                  limpar
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {validPicked
                  .map((id) => clips.find((c) => c.id === id))
                  .filter((c): c is ClipItem => Boolean(c))
                  .map((c, i) => (
                    <SelectedClip
                      key={c.id}
                      item={c}
                      index={i}
                      active={selectedId === c.id}
                      draggable={!running}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", c.id);
                        setDragId(c.id);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!dragId || dragId === c.id) return;
                        e.dataTransfer.dropEffect = "move";
                        setDragOverId(c.id);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromId = e.dataTransfer.getData("text/plain");
                        if (!fromId || fromId === c.id) return;
                        setPicked((prev) => {
                          const list = [...prev];
                          const fromIndex = list.indexOf(fromId);
                          const toIndex = list.indexOf(c.id);
                          if (fromIndex === -1 || toIndex === -1) return prev;
                          list.splice(fromIndex, 1);
                          list.splice(toIndex, 0, fromId);
                          return list;
                        });
                        setDragId(null);
                        setDragOverId(null);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOverId(null);
                      }}
                      dragging={dragId === c.id}
                      dragOver={dragOverId === c.id}
                      onSelect={() => onSelect(c.id)}
                      onUnpick={() => setPicked((prev) => prev.filter((x) => x !== c.id))}
                      onRemove={() => onRemove(c.id)}
                    />
                  ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">

            {ordered.map((c, i) => (
              <ClipCard
                key={c.id}
                item={c}
                index={i}
                active={selectedId === c.id}
                checked={validPicked.includes(c.id)}
                onToggle={() =>
                  setPicked((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))
                }
                onSelect={() => onSelect(c.id)}
                onEdit={() => onEdit(c.id)}
                onRemove={() => onRemove(c.id)}
                onDownload={() => onDownload(c)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
