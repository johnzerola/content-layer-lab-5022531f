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
  onGenerate: (item: ClipItem) => void;
  running: boolean;
  paused: boolean;
  zipping: boolean;
  eta: string | null;
  readyCount: number;
  fsAccess: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
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

function ScoreRing({ score }: { score: number }) {
  const tone = scoreTone(score);
  return (
    <div className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] ${tone.cls}`}>
      <Flame className="size-3" />
      {score}
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
  onRemove,
  onDownload,
}: {
  item: ClipItem;
  index: number;
  checked: boolean;
  active: boolean;
  onToggle: () => void;
  onSelect: () => void;
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

  return (
    <div
      onClick={onSelect}
      className={`group relative overflow-hidden rounded-xl border bg-surface-2 transition ${
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
            play();
          }}
          className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100"
        >
          <span className="grid size-11 place-items-center rounded-full bg-background/80 backdrop-blur">
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </span>
        </button>

        <div className="absolute left-2 top-2 flex items-center gap-1.5">
          <span className="rounded-md bg-background/80 px-1.5 py-0.5 font-mono text-[10px] backdrop-blur">
            #{index + 1}
          </span>
          {typeof item.score === "number" && <ScoreRing score={item.score} />}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`absolute right-2 top-2 grid size-6 place-items-center rounded-md border backdrop-blur ${
            checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background/70"
          }`}
        >
          {checked && <Check className="size-3.5" />}
        </button>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2">
          <p className="font-mono text-[11px] text-white/90">
            {formatTime(start)} – {formatTime(end)} · {Math.round(end - start)}s
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
          {item.status === "processando" && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full bg-primary" style={{ width: `${item.progress * 100}%` }} />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-1 p-2">
        <span className="truncate font-mono text-[10px] text-muted-foreground">{item.file.name}</span>
        <div className="flex items-center gap-1">
          {item.blob && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              className="rounded-md border border-border p-1.5 hover:border-primary"
            >
              <Download className="size-3.5" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
          >
            <X className="size-3.5" />
          </button>
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
}: {
  item: ClipItem;
  index: number;
  onUnpick: () => void;
  onRemove: () => void;
  onSelect: () => void;
  active: boolean;
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
      onClick={onSelect}
      className={`relative w-36 shrink-0 overflow-hidden rounded-lg border bg-surface-2 transition ${
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
    onGenerate,
    running,
    paused,
    zipping,
    eta,
    readyCount,
    fsAccess,
    selectedId,
    onSelect,
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
              <Scissors className="size-4" /> {clipBusy ? "Analisando…" : "Gerar clipes"}
            </Button>
          </div>
        </div>

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
                {ordered
                  .filter((c) => validPicked.includes(c.id))
                  .map((c, i) => (
                    <SelectedClip
                      key={c.id}
                      item={c}
                      index={i}
                      active={selectedId === c.id}
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
