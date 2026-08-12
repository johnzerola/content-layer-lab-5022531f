import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload,
  Link as LinkIcon,
  Scissors,
  X,
  Play,
  Download,
  Pencil,
  Repeat,
  Save,
  Pause,
  StopCircle,
  RotateCcw,
  FolderDown,
  FileArchive,
  Sparkles,
  Captions,
  AlertTriangle,
  Copy,
  Columns2,
  Wand2,
  Crop,
} from "lucide-react";
import { PreviewCropOverlay } from "@/components/PreviewCropOverlay";
import { Button } from "@/components/ui/button";
import { TemplateCanvas } from "@/components/TemplateCanvas";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TemplateLibrary } from "@/components/TemplateLibrary";
import { CloudPanel } from "@/components/CloudPanel";
import { autoSyncTemplates, enableCloudQuotaFallback, logBatch, logExports, type ProjectSnapshot } from "@/lib/cloud";
import { ClipStudio } from "@/components/ClipStudio";
import { VideoStudio } from "@/components/VideoStudio";
import { CleanerIAStudio } from "@/components/CleanerIAStudio";
import { defaultPreEdit, hasPreEdit, type PreEdit } from "@/lib/preedit";
import { failJob, finishJob, setJobCancel, setJobRetry, startJob, updateJob } from "@/lib/jobs";
import { undoable } from "@/lib/undo";
import { takeHandoff, takePendingTool, type HandoffTool } from "@/lib/handoff";

import {
  applyRatio,
  CANVAS_H,
  CANVAS_W,
  CAPTION_PRESETS,
  commitTemplate,

  createTemplate,
  defaultCaptions,
  fitCanvasToSource,
  orientationOf,
  loadTemplates,
  migrate,

  PLATFORM_PRESETS,
  RATIO_PRESETS,
  makeCleanupRegion,
  type CleanupRegion,
  type Template,
} from "@/lib/template";
import { detectOverlays, safeZones } from "@/lib/detect";
import { buildBackgroundPlate } from "@/lib/plate";
import { downloadBlob, grabPoster, outputIsWebm, renderVideo } from "@/lib/render";
import { webCodecsSupported } from "@/lib/encode";
import { defaultAntiDup, describeVariation, makeVariation } from "@/lib/variation";
import { autoFrame } from "@/lib/autoframe";
import { findClips, formatTime } from "@/lib/clips";
import { resolveVideoLink } from "@/lib/import.functions";
import { downloadAsZip, fsAccessSupported, saveToFolder } from "@/lib/zip";
import { cuesToSrt, cuesToText, demoCues, generateCaptions, type CaptionCue } from "@/lib/captions";
import { registerFonts } from "@/lib/fonts";
import { CaptionStudio } from "@/components/CaptionStudio";
import { CleanupStudio } from "@/components/CleanupStudio";
import { CaptionTimeline } from "@/components/CaptionTimeline";
import { canBrowserDecode, guessMime, isVideoFile, VIDEO_ACCEPT, VIDEO_EXT_RE } from "@/lib/media";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ImportPanel } from "@/components/ImportPanel";
import { FLOWS, outputName, zipName, type Mode } from "@/lib/flows";
import { Toaster } from "@/components/ui/sonner";



export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VaiViral — Editor de vídeos em lote para Reels, TikTok e Shorts" },
      {
        name: "description",
        content:
          "Editor visual estilo Canva para vídeos verticais. Crie templates reutilizáveis, importe centenas de vídeos, aplique legendas karaokê, variações antiduplicidade e baixe tudo pronto.",
      },
      { property: "og:title", content: "VaiViral — Editor de vídeos em lote 9:16" },
      {
        property: "og:description",
        content: "Template visual estilo Canva, importação em massa, anti-duplicidade e download de todos os vídeos prontos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

type Status = "pendente" | "na fila" | "processando" | "pronto" | "erro";

interface Item {
  id: string;
  file: File;
  /** link de origem quando o vídeo veio por URL (permite retomar o projeto na nuvem) */
  sourceUrl?: string | undefined;
  poster: string | null;
  w: number;
  h: number;
  duration: number;
  headline: string;
  offsetX: number;
  offsetY: number;
  autoFrameSource?: string | undefined;
  clip?: { start: number; end: number } | undefined;
  /** pré-edição feita no Estúdio (recorte, giro, cor) */
  preEdit?: PreEdit | undefined;
  score?: number | undefined;
  /** título sugerido pelo algoritmo de cortes */
  clipTitle?: string | undefined;
  /** motivo/descrição do corte */
  clipReason?: string | undefined;
  /** rótulos detectados no trecho */
  clipTags?: string[] | undefined;
  status: Status;
  progress: number;
  /** etapa atual legível (transcrição, render de cada variação, etc.) */
  stage?: string | undefined;
  stepIndex?: number | undefined;
  stepTotal?: number | undefined;
  blob?: Blob | undefined;
  ext?: string | undefined;
  /** todas as variações geradas deste vídeo */
  outputs?: { blob: Blob; ext: string; label: string }[] | undefined;
  captions?: CaptionCue[] | undefined;
  capStatus?: string | undefined;
  capError?: boolean | undefined;
  /** áreas de limpeza detectadas/ajustadas para ESTE vídeo (modo LimpaVídeo) */
  regions?: CleanupRegion[] | undefined;
  /** estado da análise automática de legenda/marca d'água */
  detectStatus?: "analisando" | "ok" | "vazio" | "erro" | undefined;
  detectMsg?: string | undefined;
  /** URL do vídeo já limpo pela GPU (CleanerIA) — vira a fonte do render */
  result_url?: string | null | undefined;

  error?: string | undefined;
}


interface QueueCtrl {
  paused: boolean;
  cancelled: boolean;
  aborts: Map<string, AbortController>;
}

/** Modo "só cortes": remove toda a marca e usa o vídeo cheio no quadro. */
function stripBranding(t: Template): Template {
  const off = <T extends { visible: boolean }>(l: T): T => ({ ...l, visible: false });
  return {
    ...t,
    background: "#000000",
    video: {
      ...t.video,
      x: 0,
      y: 0,
      w: t.canvasW ?? 1080,
      h: t.canvasH ?? 1920,
      rotation: 0,
      radius: 0,
      visible: true,
    },
    watermark: off(t.watermark),
    avatar: off(t.avatar),
    name_: off(t.name_),
    handle: off(t.handle),
    headline: off(t.headline),
    cta: off(t.cta),
    extras: [],
  };
}

/** Modo "limpar": vídeo cheio, sem marca e sem legenda nova — só as áreas de limpeza.
 *  Com as dimensões da fonte, o quadro assume a orientação real (sem zoom nem barras). */
function cleanOnly(t: Template, src?: { w: number; h: number }): Template {
  const b = stripBranding(t);
  const base: Template = {
    ...b,
    background: "#000000",
    video: {
      ...b.video,
      x: 0,
      y: 0,
      w: b.canvasW ?? CANVAS_W,
      h: b.canvasH ?? CANVAS_H,
      rotation: 0,
      radius: 0,
      offsetX: 0,
      offsetY: 0,
      fit: "auto",
      visible: true,
    },
    captions: { ...(b.captions ?? defaultCaptions()), visible: false },
  };
  return src?.w && src?.h ? fitCanvasToSource(base, src.w, src.h) : base;
}

/** Lembra qual template estava ativo entre sessões. */
const ACTIVE_KEY = "vv.active-template";

function Home() {
  const [mode, setMode] = useState<Mode>("lote");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [active, setActive] = useState<Template>(() => createTemplate("Padrão"));
  const [editing, setEditing] = useState(false);
  const [studioId, setStudioId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [webmWarn, setWebmWarn] = useState(false);
  useEffect(() => setWebmWarn(outputIsWebm()), []);
  // fallback: se o localStorage encher, os templates vão para a nuvem
  useEffect(() => {
    let lastAt = 0;
    enableCloudQuotaFallback((ok, msg, historyOnly) => {
      const now = Date.now();
      if (now - lastAt < 60_000) return; // evita spam de avisos repetidos
      lastAt = now;
      if (historyOnly) toast.info(msg, { id: "vv-quota" });
      else if (ok) toast.success(msg, { id: "vv-quota" });
      else
        toast.error(msg, {
          id: "vv-quota",
          action: { label: "Nuvem", onClick: () => setCloudOpen(true) },
        });
    });
    return () => { enableCloudQuotaFallback(); };
  }, []);



  // filas totalmente separadas por ferramenta
  const [queues, setQueues] = useState<Record<Mode, Item[]>>({
    lote: [],
    clip: [],
    limpar: [],
    "limpar-ia": [],
  });
  const [selectedIds, setSelectedIds] = useState<Record<Mode, string | null>>({
    lote: null,
    clip: null,
    limpar: null,
    "limpar-ia": null,
  });
  const queuesRef = useRef(queues);
  queuesRef.current = queues;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const setItemsIn = useCallback(
    (m: Mode, upd: Item[] | ((prev: Item[]) => Item[])) =>
      setQueues((q) => ({ ...q, [m]: typeof upd === "function" ? upd(q[m] ?? []) : upd })),
    [],
  );
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const items = queues[mode] ?? [];
  const selectedId = selectedIds[mode] ?? null;
  const setItems = useCallback(
    (upd: Item[] | ((prev: Item[]) => Item[])) => setItemsIn(modeRef.current, upd),
    [setItemsIn],
  );
  const setSelectedId = useCallback(
    (id: string | null) => setSelectedIds((s) => ({ ...s, [modeRef.current]: id })),
    [],
  );


  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [zipping, setZipping] = useState(false);
  // Canvas, decoder e encoder disputam a mesma thread/GPU. Dois vídeos em
  // paralelo frequentemente deixam ambos presos em 0% em máquinas comuns.
  const [concurrency, setConcurrency] = useState(1);
  const [bitrate, setBitrate] = useState(10);
  const [autoBitrate, setAutoBitrate] = useState(true);
  const [platforms, setPlatforms] = useState<string[]>(["reels"]);
  const togglePlatform = (id: string) =>
    setPlatforms((p) => (p.includes(id) ? (p.length > 1 ? p.filter((x) => x !== id) : p) : [...p, id]));

  const [smartFrame, setSmartFrame] = useState(true);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [linkBlocked, setLinkBlocked] = useState(false);
  const [clipBusy, setClipBusy] = useState(false);
  const [clipMinLen, setClipMinLen] = useState(20);
  const [clipMaxLen, setClipMaxLen] = useState(45);
  const [clipMax, setClipMax] = useState(6);
  const [clipMinScore, setClipMinScore] = useState(60);
  const [variants, setVariants] = useState(1);
  const [previewVariant, setPreviewVariant] = useState(0);

  const [capLang, setCapLang] = useState("pt");
  const [capBusyId, setCapBusyId] = useState<string | null>(null);
  // transcreve automaticamente no lote quando a legenda está ativa
  const [autoCap, setAutoCap] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<CleanupRegion[]>([]);
  const [compare, setCompare] = useState(false);
  /** mini editor de enquadramento direto na prévia */
  const [cropTune, setCropTune] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // as transcrições rodam em fila (uma por vez) mesmo com render paralelo
  const capChain = useRef<Promise<unknown>>(Promise.resolve());



  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const ctrlRef = useRef<QueueCtrl>({ paused: false, cancelled: false, aborts: new Map() });
  const itemsRef = useRef<Item[]>([]);
  const startedAt = useRef(0);
  const doneCount = useRef(0);
  const failures = useRef<{ name: string; error: string }[]>([]);
  const [report, setReport] = useState<{
    ok: number;
    fail: number;
    seconds: number;
    fails: { name: string; error: string }[];
  } | null>(null);

  const smartRef = useRef(smartFrame);

  itemsRef.current = items;
  smartRef.current = smartFrame;

  const templatesRef = useRef<Template[]>([]);
  templatesRef.current = templates;

  /** Salva/atualiza o template na biblioteca e devolve a versão salva. */
  const commit = useCallback((t: Template, note?: string): Template => {
    const res = commitTemplate(templatesRef.current, t, note);
    templatesRef.current = res.list;
    setTemplates(res.list);
    setActive(res.template);
    try {
      localStorage.setItem(ACTIVE_KEY, res.template.id);
    } catch {
      /* ignora */
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
    return res.template;
  }, []);

  /** Carrega um template salvo como ativo (e lembra a escolha). */
  const useTemplate = useCallback((t: Template) => {
    setActive(migrate(structuredClone(t)));
    try {
      localStorage.setItem(ACTIVE_KEY, t.id);
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    if (templates.length) autoSyncTemplates(templates);
  }, [templates]);

  useEffect(() => {
    const list = loadTemplates();
    setTemplates(list);
    let lastId: string | null = null;
    try {
      lastId = localStorage.getItem(ACTIVE_KEY);
    } catch {
      /* ignora */
    }
    const pick = list.find((t) => t.id === lastId) ?? list[0];
    if (pick) setActive(migrate(structuredClone(pick)));
    void registerFonts(list.flatMap((t) => t.fonts ?? []));
  }, []);



  const addVideos = useCallback(async (list: File[], meta?: { sourceUrl?: string }) => {
    const vids = list.filter(isVideoFile);
    const ignored = list.length - vids.length;
    if (ignored > 0) toast.warning(`${ignored} arquivo(s) ignorado(s): não são vídeos.`);
    const undecodable = vids.filter((f) => !canBrowserDecode(f));
    if (undecodable.length) {
      toast.warning(
        `${undecodable.length} arquivo(s) em formato que o navegador pode não decodificar (ex: .avi, .mkv, .wmv). Se o preview ficar preto, converta para MP4/MOV/WebM.`,
      );
    }
    const created: Item[] = vids.map((file) => ({

      id: crypto.randomUUID(),
      file,
      ...(meta?.sourceUrl ? { sourceUrl: meta.sourceUrl } : {}),
      poster: null,
      w: 0,
      h: 0,
      duration: 0,
      headline: "",
      offsetX: 0,
      offsetY: 0,
      status: "pendente",
      progress: 0,
    }));
    const runMode = modeRef.current;
    const setQ = (upd: Item[] | ((prev: Item[]) => Item[])) => setItemsIn(runMode, upd);
    setQ((prev) => [...prev, ...created]);
    if (!selectedIdsRef.current[runMode] && created[0]) setSelectedId(created[0].id);
    for (const it of created) {
      try {
        const meta = await grabPoster(it.file);
        setQ((prev) =>
          prev.map((p) => (p.id === it.id ? { ...p, poster: meta.url, w: meta.w, h: meta.h, duration: meta.duration } : p)),
        );
        if (runMode !== "limpar" && smartRef.current) {
          const af = await autoFrame(it.file);
          setQ((prev) =>
            prev.map((p) =>
              p.id === it.id ? { ...p, offsetX: af.offsetX, offsetY: af.offsetY, autoFrameSource: af.source } : p,
            ),
          );
        }
      } catch {
        setQ((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: "erro" } : p)));
      }
    }
    // LimpaVídeo: analisa cada vídeo automaticamente (2 por vez) e guarda as áreas encontradas
    if (runMode === "limpar") {
      const pool = [...created];
      const worker = async () => {
        for (;;) {
          const it = pool.shift();
          if (!it) return;
          setQ((prev) => prev.map((p) => (p.id === it.id ? { ...p, detectStatus: "analisando", detectMsg: "analisando quadros…" } : p)));
          try {
            const found = await detectOverlays(it.file, {
              onProgress: (d, t) =>
                setQ((prev) =>
                  prev.map((p) => (p.id === it.id ? { ...p, detectMsg: `analisando ${d}/${t}` } : p)),
                ),
            });
            const regions = found.map((f) => makeCleanupRegion(f));
            setQ((prev) =>
              prev.map((p) =>
                p.id === it.id
                  ? {
                      ...p,
                      regions,
                      detectStatus: regions.length ? "ok" : "vazio",
                      detectMsg: regions.length
                        ? `${regions.length} área(s) detectada(s)`
                        : "nada fixo encontrado",
                    }
                  : p,
              ),
            );
          } catch (err) {
            setQ((prev) =>
              prev.map((p) =>
                p.id === it.id
                  ? { ...p, detectStatus: "erro", detectMsg: String((err as Error)?.message ?? err) }
                  : p,
              ),
            );
          }
        }
      };
      void Promise.all([worker(), worker()]);
    }
  }, [setItemsIn, setSelectedId]);

  const addFiles = useCallback(
    (files: FileList | null) => (files ? addVideos(Array.from(files)) : Promise.resolve()),
    [addVideos],
  );

  /** Remove um item da fila deixando um "desfazer" disponível por alguns segundos. */
  const removeItemWithUndo = useCallback(
    (id: string) => {
      const mode = modeRef.current;
      let backup: Item | undefined;
      let index = -1;
      setItemsIn(mode, (p) => {
        index = p.findIndex((x) => x.id === id);
        backup = p[index];
        return p.filter((x) => x.id !== id);
      });
      undoable(`"${backup?.file.name ?? "vídeo"}" removido da fila`, () => {
        if (!backup) return;
        const restored = backup;
        setItemsIn(mode, (p) => {
          if (p.some((x) => x.id === restored.id)) return p;
          const next = [...p];
          next.splice(Math.max(0, index), 0, restored);
          return next;
        });
      });
    },
    [setItemsIn],
  );

  /** Recebe vídeos enviados por outra ferramenta (ex.: Monitora Live) sem reimportar. */
  useEffect(() => {
    const pending = takePendingTool();
    const tool: HandoffTool = pending ?? "lote";
    const files = takeHandoff(tool);
    if (files.length) {
      void addVideos(files);
      toast.success(`${files.length} vídeo(s) recebido(s) de outra ferramenta`);
    }
  }, [addVideos]);



  /** Importa um vídeo apenas colando o link (baixa pelo servidor, sem upload). */
  const importFromLink = useCallback(async () => {
    const url = linkUrl.trim();
    if (!url || linkBusy) return;
    setLinkBusy(true);
    setLinkBlocked(false);
    setLinkMsg("procurando o vídeo...");
    try {
      const res = await resolveVideoLink({ data: { url } });
      if (!res.ok || !res.videoUrl) {
        setLinkBlocked(Boolean(res.blocked));
        setLinkMsg(res.message ?? "não encontrei o vídeo nesse link");
        return;
      }
      setLinkMsg(`baixando de ${res.source ?? "origem"}...`);
      const dl = await fetch(`/api/public/media-proxy?u=${encodeURIComponent(res.videoUrl)}`);
      if (!dl.ok) {
        setLinkBlocked(true);
        setLinkMsg("a origem bloqueou o download desse arquivo");
        return;
      }
      const blob = await dl.blob();
      const urlExt = new URL(res.videoUrl).pathname.match(VIDEO_EXT_RE)?.[1]?.toLowerCase() ?? "mp4";
      const base =
        (res.title ?? "video").replace(VIDEO_EXT_RE, "").replace(/[^\w\-. ]+/g, "").trim().slice(0, 60) ||
        "video";
      const name = `${base}.${urlExt}`;
      const file = new File([blob], name, { type: blob.type || guessMime(name) });

      await addVideos([file], { sourceUrl: url });
      setLinkMsg(`importado: ${file.name} (${(file.size / 1e6).toFixed(1)} MB)`);
      setLinkUrl("");
    } catch (err) {
      setLinkMsg(String((err as Error)?.message ?? err));
    } finally {
      setLinkBusy(false);
    }
  }, [linkUrl, linkBusy, addVideos]);


  /** Snapshot do projeto atual (metadados; o vídeo volta pelo link de origem). */
  const buildSnapshot = useCallback((): ProjectSnapshot => {
    const m = modeRef.current;
    const list = queuesRef.current[m] ?? [];
    return {
      templateId: active.id,
      settings: { platforms, variants, concurrency, bitrate, autoBitrate, smartFrame, capLang },
      items: list.map((i) => ({
        name: i.file.name,
        sourceUrl: i.sourceUrl ?? null,
        headline: i.headline,
        offsetX: i.offsetX,
        offsetY: i.offsetY,
        clip: i.clip ?? null,
        score: i.score ?? null,
        regions: i.regions ?? null,
        captions: i.captions ?? null,
      })),
    };
  }, [active.id, platforms, variants, concurrency, bitrate, autoBitrate, smartFrame, capLang]);

  /** Restaura um projeto da nuvem: rebaixa os vídeos que vieram por link. */
  const restoreSnapshot = useCallback(
    async (snap: ProjectSnapshot) => {
      const st = snap.settings ?? {};
      if (Array.isArray(st["platforms"])) setPlatforms(st["platforms"] as string[]);
      if (typeof st["variants"] === "number") setVariants(st["variants"] as number);
      if (typeof st["concurrency"] === "number") setConcurrency(st["concurrency"] as number);
      if (typeof st["bitrate"] === "number") setBitrate(st["bitrate"] as number);
      if (typeof st["autoBitrate"] === "boolean") setAutoBitrate(st["autoBitrate"] as boolean);
      if (typeof st["smartFrame"] === "boolean") setSmartFrame(st["smartFrame"] as boolean);
      if (typeof st["capLang"] === "string") setCapLang(st["capLang"] as string);

      const tpl = templates.find((t) => t.id === snap.templateId);
      if (tpl) setActive(tpl);

      const linked = (snap.items ?? []).filter((i) => i.sourceUrl);
      const missing = (snap.items ?? []).length - linked.length;
      if (missing > 0) {
        toast.warning(`${missing} vídeo(s) vieram de arquivos locais — reenvie-os manualmente.`);
      }
      for (const it of linked) {
        try {
          const dl = await fetch(`/api/public/media-proxy?u=${encodeURIComponent(it.sourceUrl!)}`);
          if (!dl.ok) throw new Error("origem indisponível");
          const blob = await dl.blob();
          const file = new File([blob], it.name, { type: blob.type || guessMime(it.name) });
          await addVideos([file], { sourceUrl: it.sourceUrl! });
          setItems((prev) =>
            prev.map((x) =>
              x.file.name === it.name
                ? {
                    ...x,
                    headline: it.headline ?? x.headline,
                    offsetX: it.offsetX ?? x.offsetX,
                    offsetY: it.offsetY ?? x.offsetY,
                    clip: (it.clip ?? undefined) as Item["clip"],
                    score: (it.score ?? undefined) as number | undefined,
                    regions: (it.regions ?? undefined) as Item["regions"],
                    captions: (it.captions ?? undefined) as Item["captions"],
                  }
                : x,
            ),
          );
        } catch {
          toast.error(`Não consegui rebaixar "${it.name}".`);
        }
      }
      setCloudOpen(false);
    },
    [addVideos, setItems, templates],
  );

  /** Clipagem automática: quebra um vídeo longo nos melhores trechos. */
  const autoClip = useCallback(
    async (item: Item) => {
      if (clipBusy) return;
      setClipBusy(true);
      try {
        const clips = await findClips(item.file, {
          minLen: Math.min(clipMinLen, clipMaxLen),
          maxLen: Math.max(clipMinLen, clipMaxLen),
          max: clipMax,
          minScore: clipMinScore,
        });
        if (!clips.length) {
          setLinkMsg("nenhum trecho atingiu o score mínimo — reduza a intensidade do score");
          return;
        }
        const created: Item[] = clips.map((c) => ({
          id: crypto.randomUUID(),
          file: item.file,
          poster: item.poster,
          w: item.w,
          h: item.h,
          duration: c.end - c.start,
          headline: item.headline,
          offsetX: item.offsetX,
          offsetY: item.offsetY,
          clip: { start: c.start, end: c.end },
          score: c.score,
          clipTitle: c.title,
          clipReason: c.reason,
          clipTags: c.tags,
          status: "pendente" as Status,
          progress: 0,
          ...(item.autoFrameSource ? { autoFrameSource: item.autoFrameSource } : {}),
        }));
        setItems((prev) =>
          modeRef.current === "clip"
            ? // no estúdio o vídeo longo continua na lista para novas gerações
              [...prev.filter((p) => !(p.clip && p.file === item.file)), ...created]
            : [...prev.filter((p) => p.id !== item.id), ...created],
        );
        setSelectedId(created[0]?.id ?? null);
        // miniatura no início de cada corte
        for (const c of created) {
          try {
            const meta = await grabPoster(item.file, (c.clip?.start ?? 0) + 0.5);
            setItems((prev) => prev.map((p) => (p.id === c.id ? { ...p, poster: meta.url } : p)));
          } catch {
            /* mantém a miniatura do vídeo original */
          }
        }

      } catch (err) {
        setLinkMsg(`falha na clipagem: ${String((err as Error)?.message ?? err)}`);
      } finally {
        setClipBusy(false);
      }
    },
    [clipBusy, clipMinLen, clipMaxLen, clipMax, clipMinScore],
  );

  /** Transcreve o áudio e gera legendas com tempo por palavra. */
  const makeCaptions = useCallback(
    async (item: Item) => {
      if (capBusyId) return;
      setCapBusyId(item.id);
      setItems((p) =>
        p.map((x) => (x.id === item.id ? { ...x, capStatus: "ouvindo o áudio...", capError: false } : x)),
      );
      try {
        const cues = await generateCaptions(item.file, {
          clip: item.clip,
          language: capLang || undefined,
          onProgress: ({ done, total }) =>
            setItems((p) =>
              p.map((x) => (x.id === item.id ? { ...x, capStatus: `transcrevendo ${done}/${total}` } : x)),
            ),
        });
        setItems((p) =>
          p.map((x) =>
            x.id === item.id
              ? {
                  ...x,
                  captions: cues,
                  capError: false,
                  capStatus: `${cues.length} blocos · ${cues.reduce((n, c) => n + c.words.length, 0)} palavras`,
                }
              : x,
          ),
        );
        if (cues.length) setActive((t) => ({ ...t, captions: { ...(t.captions ?? defaultCaptions()), visible: true } }));
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        setItems((p) => p.map((x) => (x.id === item.id ? { ...x, capStatus: msg, capError: true } : x)));
      } finally {

        setCapBusyId(null);
      }
    },
    [capBusyId, capLang],
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const studioItem = studioId ? (items.find((i) => i.id === studioId) ?? null) : null;


  const antiDup = active.antiDup ?? defaultAntiDup();
  const setAntiDup = (patch: Partial<typeof antiDup>) =>
    setActive((t) => ({ ...t, antiDup: { ...(t.antiDup ?? defaultAntiDup()), ...patch } }));

  const variationOf = useCallback(
    (item: Item, variant = 0) =>
      makeVariation(
        { ...(active.antiDup ?? defaultAntiDup()), mirror: active.mirror, speed: active.speed },
        `${item.file.name}:${item.file.size}:${item.id}${variant ? `#${variant}` : ""}`,
      ),
    [active],
  );

  // reflete a anti-duplicidade no preview em tempo real (mesma seed usada na exportação)
  const variantIdx = Math.min(previewVariant, Math.max(0, variants - 1));
  const previewVariation = selected ? variationOf(selected, variantIdx) : null;

  const capStyle = active.captions ?? defaultCaptions();

  // sem transcrição ainda? mostra legenda de exemplo pra ver o estilo na prévia
  const previewCues = useMemo(() => {
    if (selected?.captions?.length) return selected.captions;
    if (!capStyle.visible) return undefined;
    const base = demoCues();
    const span = base[0]!.end;
    const out: CaptionCue[] = [];
    for (let k = 0; k < Math.ceil(120 / span); k++) {
      const off = k * span;
      out.push({
        start: base[0]!.start + off,
        end: base[0]!.end + off,
        words: base[0]!.words.map((w) => ({ ...w, start: w.start + off, end: w.end + off })),
      });
    }
    return out;
  }, [selected?.captions, capStyle.visible]);

  // mesma janela calculada pelo encoder (clipe + corte anti-duplicidade)
  const previewLoop = useMemo(() => {
    const v = previewVariation;
    const dur = selected?.duration || 0;
    if (!v || !dur) return { start: 0, end: undefined as number | undefined };
    const clipStart = Math.max(0, Math.min(selected?.clip?.start ?? 0, Math.max(0, dur - 0.5)));
    const clipEnd = Math.min(dur, selected?.clip?.end ?? dur);
    const clipDur = Math.max(0.5, clipEnd - clipStart);
    const start = clipStart + Math.min(v.trimStart, Math.max(0, clipDur - 0.5));
    const effDur = Math.max(0.2, clipDur - (start - clipStart) - v.trimEnd);
    return { start, end: start + effDur };
  }, [previewVariation?.trimStart, previewVariation?.trimEnd, selected?.duration, selected?.clip?.start, selected?.clip?.end]);

  // placa de fundo real (mediana temporal) usada no preview do LimpaVídeo
  const [previewPlate, setPreviewPlate] = useState<{
    canvas: HTMLCanvasElement;
    ok: Set<string>;
  } | null>(null);
  const selRegionsKey = JSON.stringify(
    (selected?.regions ?? []).filter((r) => r.enabled).map((r) => [r.id, r.x, r.y, r.w, r.h, r.mode]),
  );
  useEffect(() => {
    if (mode !== "limpar" || !selected?.file) {
      setPreviewPlate(null);
      return;
    }
    let alive = true;
    const regions = (selected.regions ?? []).filter((r) => r.enabled);
    if (!regions.length) {
      setPreviewPlate(null);
      return;
    }
    const timer = setTimeout(() => {
      buildBackgroundPlate(selected.file, regions, { frames: 14 })
        .then((p) => alive && setPreviewPlate(p))
        .catch(() => alive && setPreviewPlate(null));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [mode, selected?.id, selRegionsKey]);

  const previewDrawOpts = useMemo(
    () =>
      previewVariation
        ? {
            mirror: previewVariation.mirror,
            brightness: previewVariation.brightness,
            saturation: previewVariation.saturation,
            zoom: previewVariation.zoom,
            noise: previewVariation.noise,
            rotate: previewVariation.rotate,
            border: previewVariation.border,
            borderColor: previewVariation.borderColor,
            ...(previewCues?.length ? { captions: previewCues } : {}),
            ...(previewPlate ? { plate: previewPlate } : {}),
            ...(selected?.preEdit
              ? {
                  pre: selected.preEdit,
                  clip: selected.clip ?? { start: 0, end: selected.duration || 0 },
                }
              : {}),
          }
        : selected?.preEdit
          ? {
              pre: selected.preEdit,
              clip: selected.clip ?? { start: 0, end: selected.duration || 0 },
              ...(previewCues?.length ? { captions: previewCues } : {}),
              ...(previewPlate ? { plate: previewPlate } : {}),
            }
          : undefined,
    [
      previewVariation?.mirror,
      previewVariation?.brightness,
      previewVariation?.saturation,
      previewVariation?.zoom,
      previewVariation?.noise,
      previewVariation?.rotate,
      previewVariation?.border,
      previewVariation?.borderColor,
      previewCues,
      previewPlate,
      selected?.preEdit,
      selected?.clip,
      selected?.duration,
    ],
  );





  const processAll = async (onlyIds?: string[], safe = false) => {
    // a fila roda presa à ferramenta em que foi disparada
    const runMode = modeRef.current;
    const runFlow = FLOWS[runMode].export;
    const setItems = (upd: Item[] | ((prev: Item[]) => Item[])) => setItemsIn(runMode, upd);
    const listNow = () => queuesRef.current[runMode] ?? [];
    const ctrl = ctrlRef.current;
    ctrl.paused = false;
    ctrl.cancelled = false;
    setPaused(false);
    setRunning(true);
    startedAt.current = performance.now();
    doneCount.current = 0;
    failures.current = [];
    setReport(null);


    const pending = listNow()
      .filter((i) => (onlyIds ? onlyIds.includes(i.id) : i.status !== "pronto"))
      .map((i) => i.id);
    const queue = [...pending];
    setItems((p) => p.map((x) => (queue.includes(x.id) ? { ...x, status: "na fila", progress: 0, stage: "na fila", stepIndex: 0, stepTotal: 0 } : x)));

    const worker = async () => {
      while (queue.length) {
        while (ctrl.paused && !ctrl.cancelled) await new Promise((r) => setTimeout(r, 200));
        if (ctrl.cancelled) return;
        const id = queue.shift();
        if (!id) return;
        const item = listNow().find((x) => x.id === id);
        if (!item) continue;
        const ac = new AbortController();
        ctrl.aborts.set(id, ac);
        // central de atividade: um trabalho por vídeo, com etapas cronometradas
        startJob({
          id,
          tool: runMode as any,
          name: item.file.name,
          stage: "preparando",
          meta: { seguro: safe, plataformas: platforms.join(", ") },
        });
        updateJob(id, { status: "processando", safeMode: safe });
        setJobCancel(id, () => ac.abort());
        setJobRetry(id, (asSafe) => void processAll([id], asSafe));
        setItems((p) => p.map((x) => (x.id === id ? { ...x, status: "processando", progress: 0, stage: "preparando", stepIndex: 0, stepTotal: 0 } : x)));
        const runItem = async () => {

          const n = runFlow.variants ? Math.max(1, variants) : 1;
          const targets = runFlow.platforms
            ? PLATFORM_PRESETS.filter((p) => platforms.includes(p.id))
            : [];
          const outs = targets.length ? targets : [PLATFORM_PRESETS[0]!];
          const total = n * outs.length;
          const outputs: { blob: Blob; ext: string; label: string }[] = [];
          let step = 0;

          // CleanerIA: o render precisa partir do vídeo já reconstruído pela GPU,
          // senão a legenda original volta a aparecer na exportação.
          let sourceFile = item.file;
          if (runMode === "limpar-ia") {
            if (!item.result_url) {
              throw new Error(
                "Este vídeo ainda não foi limpo pela IA. Marque as áreas e clique em “Enviar para GPU” antes de processar.",
              );
            }
            setItems((p) =>
              p.map((x) => (x.id === id ? { ...x, stage: "baixando vídeo limpo" } : x)),
            );
            updateJob(id, { stage: "baixando vídeo limpo" });
            const res = await fetch(item.result_url, { signal: ac.signal });
            if (!res.ok) throw new Error("Não consegui baixar o vídeo limpo da GPU.");
            const cleaned = await res.blob();
            sourceFile = new File([cleaned], item.file.name, {
              type: cleaned.type || "video/mp4",
            });
          }

          const baseTpl =
            runMode === "clip"
              ? stripBranding(active)
              : runMode === "limpar" || runMode === "limpar-ia"
                ? cleanOnly(active)
                : active;


          // transcreve na hora do processamento, para queimar a legenda no vídeo
          let cues = item.captions;
          const wantCaptions = (active.captions ?? defaultCaptions()).visible;
          if (autoCap && wantCaptions && !cues?.length) {
            const run = capChain.current.then(async () => {
              if (ctrl.cancelled || ac.signal.aborted) return undefined;
              setItems((p) =>
                p.map((x) => (x.id === id ? { ...x, capStatus: "transcrevendo…", capError: false, stage: "transcrevendo áudio" } : x)),
              );
              updateJob(id, { stage: "transcrevendo áudio" });
              return generateCaptions(item.file, {
                clip: item.clip,
                language: capLang || undefined,
                onProgress: ({ done, total: t }) =>
                  setItems((p) =>
                    p.map((x) =>
                      x.id === id
                        ? { ...x, capStatus: `transcrevendo ${done}/${t}`, stage: `transcrevendo ${done}/${t}` }
                        : x,
                    ),
                  ),
              });
            });
            capChain.current = run.catch(() => undefined);
            try {
              const got = await run;
              if (got?.length) {
                cues = got;
                setItems((p) =>
                  p.map((x) =>
                    x.id === id
                      ? { ...x, captions: got, capError: false, capStatus: `${got.length} blocos` }
                      : x,
                  ),
                );
              }
            } catch (err) {
              // sem legenda o vídeo ainda é exportado normalmente
              const msg = String((err as Error)?.message ?? err);
              setItems((p) => p.map((x) => (x.id === id ? { ...x, capStatus: msg, capError: true } : x)));
            }
          }


          // LimpaVídeo: recupera o fundo real por mediana temporal antes de renderizar
          const itemRegions = item.regions?.length ? item.regions : (active.cleanup ?? []);
          let plate: Awaited<ReturnType<typeof buildBackgroundPlate>> = null;
          if (runMode === "limpar" && itemRegions.length) {
            setItems((p) =>
              p.map((x) => (x.id === id ? { ...x, stage: "recuperando fundo original" } : x)),
            );
            updateJob(id, { stage: "recuperando fundo original" });
            try {
              plate = await buildBackgroundPlate(item.file, itemRegions, {
                ...(item.clip ? { clip: item.clip } : {}),
                signal: ac.signal,
              });
            } catch {
              plate = null;
            }
          }

          for (const plat of outs) {
            // cada plataforma recebe a resolução/fps/bitrate recomendados
            // no modo "limpar" o quadro segue a orientação real do vídeo (sem recorte)
            const tpl =
              runMode === "limpar"
                ? {
                    ...cleanOnly(active, { w: item.w, h: item.h }),
                    // cada vídeo usa as áreas detectadas para ele; sem detecção, usa as do template
                    cleanup: itemRegions,
                  }
                : runMode === "limpar-ia"
                  ? // a limpeza já foi feita na GPU: só reembala mantendo proporção original
                    { ...cleanOnly(active, { w: item.w, h: item.h }), cleanup: [] }
                  : applyRatio(baseTpl, plat.w, plat.h);

            for (let k = 0; k < n; k++) {
              const at = step;
              const stageLabel = `render ${at + 1}/${total}${outs.length > 1 ? ` · ${plat.short}` : ""}${n > 1 ? ` · v${k + 1}` : ""}`;
              setItems((prev) =>
                prev.map((x) =>
                  x.id === id ? { ...x, stage: stageLabel, stepIndex: at + 1, stepTotal: total } : x,
                ),
              );
              updateJob(id, { stage: stageLabel });
              const { blob, ext } = await renderVideo(sourceFile, tpl, {

                variation: variationOf(item, k),
                offsetX: item.offsetX,
                offsetY: item.offsetY,
                headline: item.headline || undefined,
                // modo seguro: menos quadros e bitrate menor para destravar o render
                fps: safe ? 24 : plat.fps,
                bitrate: safe ? 4_000_000 : (autoBitrate ? plat.bitrate : bitrate) * 1_000_000,
                clip: item.clip,
                pre: item.preEdit,
                captions: cues,
                plate,
                signal: ac.signal,
                onProgress: (p) => {
                  const value = (at + p) / total;
                  setItems((prev) =>
                    prev.map((x) => (x.id === id ? { ...x, progress: value } : x)),
                  );
                  updateJob(id, { progress: value });
                },
              });
              const label = [outs.length > 1 ? plat.short : "", n > 1 ? `v${k + 1}` : ""]
                .filter(Boolean)
                .join("-");
              outputs.push({ blob, ext, label });
              step++;
            }
          }

          doneCount.current++;
          finishJob(id, `${outputs.length} arquivo(s) prontos`);
          const first = outputs[0]!;
          setItems((p) =>
            p.map((x) =>
              x.id === id
                ? {
                    ...x,
                    status: "pronto",
                    blob: first.blob,
                    ext: first.ext,
                    outputs,
                    progress: 1,
                    stage: `${outputs.length} arquivo(s) prontos`,
                  }
                : x,
            ),
          );
        };

        // até 2 tentativas por vídeo: uma falha isolada não derruba o lote
        try {
          let lastErr: unknown = null;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              await runItem();
              lastErr = null;
              break;
            } catch (err) {
              lastErr = err;
              const aborted = (err as Error)?.name === "AbortError" || ctrl.cancelled;
              if (aborted || attempt === 2) break;
              setItems((p) =>
                p.map((x) => (x.id === id ? { ...x, status: "processando", progress: 0, stage: "nova tentativa…" } : x)),
              );
              await new Promise((r) => setTimeout(r, 500));
            }
          }
          if (lastErr) throw lastErr;
        } catch (err) {
          const aborted = (err as Error)?.name === "AbortError";
          const msg = String((err as Error)?.message ?? err);
          if (!aborted) failures.current.push({ name: listNow().find((x) => x.id === id)?.file.name ?? id, error: msg });
          setItems((p) =>
            p.map((x) =>
              x.id === id
                ? { ...x, status: aborted ? "pendente" : "erro", error: aborted ? undefined : msg }
                : x,
            ),
          );
          if (aborted) updateJob(id, { status: "cancelado", stage: "cancelado" });
          else failJob(id, msg);
        } finally {
          ctrl.aborts.delete(id);
        }

      }
    };

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    setRunning(false);
    if (!ctrl.cancelled) {
      const seconds = Math.max(1, Math.round((performance.now() - startedAt.current) / 1000));
      setReport({
        ok: doneCount.current,
        fail: failures.current.length,
        seconds,
        fails: [...failures.current],
      });
      void logExports(
        listNow()
          .filter((i) => i.status === "pronto")
          .flatMap((i) =>
            (i.outputs?.length ? i.outputs : i.blob ? [{ blob: i.blob, ext: i.ext ?? "mp4", label: "" }] : []).map(
              (o) => ({
                mode: runMode,
                fileName: `${i.file.name.replace(/\.[^.]+$/, "")}${o.label ? `-${o.label}` : ""}.${o.ext}`,
                sourceName: i.file.name,
                platform: platforms.join(","),
                ...(o.label ? { variant: o.label } : {}),
                bytes: o.blob.size,
                seconds: i.duration,
              }),
            ),
          ),
      ).catch(() => {});
      void logBatch({
        mode: runMode,
        templateName: active.name,
        platforms,
        videos: listNow().length,
        ok: doneCount.current,
        failed: failures.current.length,
        seconds,
      }).catch(() => {});
    }

  };


  const togglePause = () => {
    ctrlRef.current.paused = !ctrlRef.current.paused;
    setPaused(ctrlRef.current.paused);
  };

  const cancelAll = () => {
    ctrlRef.current.cancelled = true;
    ctrlRef.current.paused = false;
    ctrlRef.current.aborts.forEach((a) => a.abort());
    ctrlRef.current.aborts.clear();
    setPaused(false);
    setRunning(false);
    setItems((p) => p.map((x) => (x.status === "processando" || x.status === "na fila" ? { ...x, status: "pendente" } : x)));
  };

  const retryErrors = () => {
    const ids = items.filter((i) => i.status === "erro").map((i) => i.id);
    if (ids.length) void processAll(ids);
  };

  /** Re-analisa o vídeo selecionado e grava as áreas encontradas NELE. */
  const runDetect = async () => {
    const it = itemsRef.current.find((x) => x.id === selectedId);
    if (!it) return;
    setDetecting(true);
    setSuggestions([]);
    setDetectMsg("analisando quadros…");
    try {
      const found = await detectOverlays(it.file, {
        clip: it.clip,
        onProgress: (d, t) => setDetectMsg(`analisando quadros ${d}/${t}…`),
      });
      const regions = found.map((f) => makeCleanupRegion(f));
      setItems((p) =>
        p.map((x) =>
          x.id === it.id
            ? { ...x, regions, detectStatus: regions.length ? "ok" : "vazio", detectMsg: undefined }
            : x,
        ),
      );
      if (regions.length) {
        setDetectMsg(`${regions.length} área(s) aplicada(s) automaticamente`);
      } else {
        setSuggestions(safeZones().map((z) => makeCleanupRegion(z)));
        setDetectMsg("nada fixo encontrado — use as zonas sugeridas ou marque manualmente");
      }
    } catch (err) {
      setSuggestions([]);
      setDetectMsg(`falha na detecção: ${String((err as Error)?.message ?? err)}`);
    } finally {
      setDetecting(false);
    }
  };

  /** áreas de limpeza do vídeo selecionado (fallback: as do template) */
  const cleanupRegions: CleanupRegion[] =
    mode === "limpar" ? (selected?.regions ?? active.cleanup ?? []) : (active.cleanup ?? []);
  const setCleanupRegions = (regions: CleanupRegion[]) => {
    if (mode === "limpar" && selected) {
      setItems((p) => p.map((x) => (x.id === selected.id ? { ...x, regions } : x)));
    } else {
      setActive((t) => ({ ...t, cleanup: regions }));
    }
  };
  const applyRegionsToAll = () => {
    const regions = cleanupRegions;
    setItems((p) =>
      p.map((x) => ({
        ...x,
        regions: regions.map((r) => ({ ...r, id: crypto.randomUUID() })),
        detectStatus: "ok" as const,
        detectMsg: `${regions.length} área(s) do vídeo modelo`,
      })),
    );
    toast.success(`Áreas aplicadas em ${items.length} vídeo(s).`);
  };


  const readyCount = items.filter((i) => i.status === "pronto").length;
  const errorCount = items.filter((i) => i.status === "erro").length;
  // progresso global do lote: soma do progresso de cada arquivo em andamento/concluído
  const batchItems = items.filter((i) => i.status !== "pendente");
  const batchDone = batchItems.filter((i) => i.status === "pronto" || i.status === "erro").length;
  const batchProgress = batchItems.length
    ? batchItems.reduce((a, i) => a + (i.status === "pronto" || i.status === "erro" ? 1 : i.progress), 0) /
      batchItems.length
    : 0;
  const activeItem = items.find((i) => i.status === "processando");
  const pendingCount = items.filter((i) => i.status !== "pronto").length;

  const eta = (() => {
    if (!running || doneCount.current === 0) return null;
    const per = (performance.now() - startedAt.current) / doneCount.current;
    const left = (per * pendingCount) / Math.max(1, concurrency);
    const s = Math.round(left / 1000);
    return s > 90 ? `${Math.round(s / 60)} min` : `${s}s`;
  })();

  const flow = FLOWS[mode];

  const outFiles = () => {
    const files: { name: string; blob: Blob }[] = [];
    items.forEach((i, idx) => {
      const outs = i.outputs ?? (i.blob ? [{ blob: i.blob, ext: i.ext ?? "mp4", label: "" }] : []);
      outs.forEach((o) => {
        files.push({
          name: outputName(mode, {
            index: idx,
            sourceName: i.file.name,
            templateName: active.name,
            label: o.label,
            ext: o.ext,
          }),
          blob: o.blob,
        });
      });
    });
    return files;
  };

  const downloadZipAll = async () => {
    setZipping(true);
    try {
      await downloadAsZip(outFiles(), zipName(mode, active.name));
    } finally {
      setZipping(false);
    }
  };

  const saveFolder = async () => {
    try {
      await saveToFolder(outFiles());
    } catch {
      /* cancelado */
    }
  };


  const baseTpl: Template =
    mode === "clip"
      ? stripBranding(active)
      : mode === "limpar"
        ? cleanOnly(active, selected ? { w: selected.w, h: selected.h } : undefined)
        : active;
  const previewTemplate: Template = selected
    ? {
        ...baseTpl,
        headline: { ...baseTpl.headline, text: selected.headline || baseTpl.headline.text },
        cleanup: mode === "limpar" ? cleanupRegions : (baseTpl.cleanup ?? []),
        video: {
          ...baseTpl.video,
          offsetX: mode === "limpar" ? 0 : selected.offsetX,
          offsetY: mode === "limpar" ? 0 : selected.offsetY,
        },
      }
    : baseTpl;

  return (
    <AppShell
      mode={mode}
      onMode={(m) => setMode(m as Mode)}
      count={items.length}
      counts={{ 
        lote: queues.lote.length, 
        clip: queues.clip.length, 
        limpar: queues.limpar.length,
        "limpar-ia": queues["limpar-ia"].length 
      }}
      onLibrary={() => setLibraryOpen(true)}
      onCloud={() => setCloudOpen(true)}
    >
      <Toaster />

      <div className="space-y-5">

        {webmWarn && (
          <div className="flex items-start gap-3 rounded-xl border border-warn/50 bg-warn/10 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              <p className="text-warn">este navegador não gera MP4</p>
              <p>
                a saída sairá em WebM, que o Instagram e o TikTok recusam. Abra o VaiViral no Chrome ou Edge
                atualizados (desktop) para exportar MP4 H.264 — ou converta os arquivos antes de publicar.
              </p>
            </div>
          </div>
        )}

        {mode === "lote" ? (
        <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="mono-label">Template ativo</p>
            <p className="text-lg font-semibold">{active.name}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              v{active.version ?? 1}
              {templates.some((t) => t.id === active.id) ? "" : " · não salvo"}
              {savedFlash && <span className="ml-2 text-primary">● salvo</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {templates.length > 0 && (
              <select
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                value={templates.some((t) => t.id === active.id) ? active.id : ""}
                onChange={(e) => {
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t) useTemplate(t);

                }}
              >
                <option value="" disabled>
                  Meus templates
                </option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · v{t.version ?? 1}
                  </option>
                ))}
              </select>
            )}
            <select
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
              value={`${active.canvasW ?? 1080}x${active.canvasH ?? 1920}`}
              onChange={(e) => {
                const p = RATIO_PRESETS.find((r) => `${r.w}x${r.h}` === e.target.value);
                if (p) setActive(applyRatio(active, p.w, p.h));
              }}
            >
              {RATIO_PRESETS.map((r) => (
                <option key={r.id} value={`${r.w}x${r.h}`}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => setActive(createTemplate("Novo template"))}>
              Novo
            </Button>

            <Button variant="outline" onClick={() => commit(active, "salvo manualmente")}>
              <Save className="size-4" /> Salvar versão
            </Button>
            <Button onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Editar template
            </Button>
          </div>
        </section>
        ) : mode === "limpar" ? (
          <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="mono-label">Limpar vídeo</p>
              <p className="text-lg font-semibold">Remover legenda queimada, marca d'água e textos</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                marque as áreas sobre o quadro no preview — clonar vizinho, borrão, mosaico ou tarja
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground">
                {(active.cleanup ?? []).length} área{(active.cleanup ?? []).length === 1 ? "" : "s"}
              </span>
              <select
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                value={`${active.canvasW ?? 1080}x${active.canvasH ?? 1920}`}
                onChange={(e) => {
                  const p = RATIO_PRESETS.find((r) => `${r.w}x${r.h}` === e.target.value);
                  if (p) setActive(applyRatio(active, p.w, p.h));
                }}
              >
                {RATIO_PRESETS.map((r) => (
                  <option key={r.id} value={`${r.w}x${r.h}`}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </section>
        ) : mode === "limpar-ia" ? (
          <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="mono-label">AI Video Cleaner</p>
              <p className="text-lg font-semibold">Remoção Profissional com ProPainter (GPU)</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                reconstrução temporal avançada utilizando frames vizinhos para restaurar o fundo original
              </p>
            </div>
            <div className="flex items-center gap-2">
               <span className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 font-mono text-[11px] text-primary">
                 <Sparkles className="size-3" /> motor gpu
               </span>
            </div>
          </section>
        ) : (
          <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="mono-label">Só cortes</p>
              <p className="text-lg font-semibold">Vídeo longo → clipes prontos</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                sem marca, sem headline — só recorte, proporção e anti-duplicidade
              </p>
            </div>
            <select
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
              value={`${active.canvasW ?? 1080}x${active.canvasH ?? 1920}`}
              onChange={(e) => {
                const p = RATIO_PRESETS.find((r) => `${r.w}x${r.h}` === e.target.value);
                if (p) setActive(applyRatio(active, p.w, p.h));
              }}
            >
              {RATIO_PRESETS.map((r) => (
                <option key={r.id} value={`${r.w}x${r.h}`}>
                  {r.label}
                </option>
              ))}
            </select>
          </section>
        )}


        <ImportPanel
          mode={mode}
          count={items.length}
          onFiles={(f) => void addFiles(f)}
          linkUrl={linkUrl}
          onLinkUrl={setLinkUrl}
          linkBusy={linkBusy}
          linkMsg={linkMsg}
          linkBlocked={linkBlocked}
          onImportLink={() => void importFromLink()}
        />

        {mode === "clip" && items.length > 0 && (
          <ClipStudio
            sources={items.filter((i) => !i.clip)}
            clips={items.filter((i) => i.clip)}
            settings={{ minLen: clipMinLen, maxLen: clipMaxLen, max: clipMax, minScore: clipMinScore }}
            onSettings={(p) => {
              if (p.minLen !== undefined) setClipMinLen(p.minLen);
              if (p.maxLen !== undefined) setClipMaxLen(p.maxLen);
              if (p.max !== undefined) setClipMax(p.max);
              if (p.minScore !== undefined) setClipMinScore(p.minScore);
            }}
            clipBusy={clipBusy}
            onGenerate={(it) => void autoClip(items.find((x) => x.id === it.id)!)}
            running={running}
            paused={paused}
            zipping={zipping}
            eta={eta}
            readyCount={readyCount}
            fsAccess={fsAccessSupported()}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onProcess={(ids) => void processAll(ids)}
            onTogglePause={togglePause}
            onCancel={cancelAll}
            onRemove={(id) => removeItemWithUndo(id)}
            onDownload={(it) => it.blob && downloadBlob(it.blob, `corte-${it.id.slice(0, 6)}.${it.ext}`)}
            onZip={() => void downloadZipAll()}
            onSaveFolder={() => void saveFolder()}
          />
        )}

        {mode !== "clip" && items.length > 0 && (

          <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
            <section className="panel space-y-4 p-5">
              <div>
                <p className="text-lg font-semibold">
                  <span className="step-num mr-2">03</span>Preview & ajuste individual
                </p>
                <p className="text-sm text-muted-foreground">
                  Reposicione o enquadramento quando o corte automático errar.
                </p>
              </div>
              {mode === "limpar-ia" && selected ? (
                <CleanerIAStudio 
                  item={{
                    id: selected.id,
                    file: selected.file,
                    poster: selected.poster,
                    w: selected.w,
                    h: selected.h
                  }}
                  onComplete={(url) => {
                    setItems(prev => prev.map(x => x.id === selected.id ? { ...x, result_url: url, status: "pronto" as any } : x));
                  }}
                />
              ) : selected ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="mono-label">Original</p>
                    {selected.poster ? (
                      <img src={selected.poster} alt="quadro original" className="w-full rounded-xl border border-border" />
                    ) : (
                      <div className="grid h-52 place-items-center rounded-xl border border-border text-xs text-muted-foreground">
                        carregando quadro…
                      </div>
                    )}
                    <div className="space-y-2 pt-1">
                      {mode === "lote" && (
                      <input
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                        placeholder="Headline só deste vídeo (opcional)"
                        value={selected.headline}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.id === selected.id ? { ...x, headline: e.target.value } : x)))
                        }
                      />
                      )}
                      {(["offsetX", "offsetY"] as const).map((axis) => (
                        <label key={axis} className="block text-xs text-muted-foreground">
                          Corte {axis === "offsetX" ? "horizontal" : "vertical"}
                          <input
                            type="range"
                            min={-1}
                            max={1}
                            step={0.02}
                            value={selected[axis]}
                            onChange={(e) =>
                              setItems((p) =>
                                p.map((x) => (x.id === selected.id ? { ...x, [axis]: Number(e.target.value) } : x)),
                              )
                            }
                            className="w-full accent-[var(--primary)]"
                          />
                        </label>
                      ))}
                      <button
                        className="flex items-center gap-1.5 font-mono text-xs text-primary"
                        onClick={() =>
                          setItems((p) => p.map((x) => (x.id === selected.id ? { ...x, offsetX: 0, offsetY: 0 } : x)))
                        }
                      >
                        <Repeat className="size-3" /> restaurar auto
                      </button>
                    </div>
                    <div className="mt-3 border-t border-border pt-3">
                      <CleanupStudio
                        regions={cleanupRegions}
                        onChange={setCleanupRegions}
                        poster={selected.poster ?? undefined}
                        aspect={previewTemplate.video.w / previewTemplate.video.h}
                        onDetect={() => void runDetect()}
                        detecting={detecting || selected.detectStatus === "analisando"}
                        detectMsg={
                          selected.detectStatus === "analisando"
                            ? (selected.detectMsg ?? "analisando quadros…")
                            : (detectMsg ?? selected.detectMsg)
                        }
                        perVideo={mode === "limpar"}
                        onApplyAll={mode === "limpar" && items.length > 1 ? applyRegionsToAll : undefined}
                        onUseSafeZones={() =>
                          setCleanupRegions([
                            ...cleanupRegions,
                            ...safeZones().map((z) => makeCleanupRegion(z)),
                          ])
                        }
                        suggestions={suggestions}
                        onUseSuggestion={(r) => {
                          setCleanupRegions([...cleanupRegions, r]);
                          setSuggestions((s) => s.filter((x) => x.id !== r.id));
                        }}
                        onUseAllSuggestions={() => {
                          setCleanupRegions([...cleanupRegions, ...suggestions]);
                          setSuggestions([]);
                          setDetectMsg(undefined);
                        }}
                        onClearSuggestions={() => {
                          setSuggestions([]);
                          setDetectMsg(undefined);
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="mono-label">
                        Preview final
                        {selected?.w ? (
                          <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                            {orientationOf(selected.w, selected.h) === "horizontal"
                              ? "horizontal"
                              : orientationOf(selected.w, selected.h) === "square"
                                ? "quadrado"
                                : "vertical"}{" "}
                            · {selected.w}×{selected.h}
                          </span>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setCompare((c) => !c)}
                          className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                            compare
                              ? "border-primary/60 bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Columns2 className="mr-1 inline size-3" /> comparar
                        </button>
                        <button
                          type="button"
                          onClick={() => setCropTune((c) => !c)}
                          className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                            cropTune
                              ? "border-primary/60 bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <Crop className="mr-1 inline size-3" /> ajustar corte
                        </button>
                        {variants > 1 && (
                          <select
                            value={variantIdx}
                            onChange={(e) => setPreviewVariant(Number(e.target.value))}
                            className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px]"
                          >
                            {Array.from({ length: variants }, (_, k) => (
                              <option key={k} value={k}>
                                prévia da variação v{k + 1}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                    {compare ? (
                      <BeforeAfterSlider
                        beforeLabel="original"
                        afterLabel={`limpo${variants > 1 ? ` · v${variantIdx + 1}` : ""}`}
                        before={
                          <TemplateCanvas
                            template={{ ...previewTemplate, cleanup: [] }}
                            interactive={false}
                            poster={selected.poster}
                            previewFile={selected.file}
                            drawOpts={previewDrawOpts}
                            speed={previewVariation?.speed ?? 1}
                            loopStart={previewLoop.start}
                            loopEnd={previewLoop.end}
                          />
                        }
                        after={
                          <TemplateCanvas
                            template={previewTemplate}
                            interactive={false}
                            poster={selected.poster}
                            previewFile={selected.file}
                            drawOpts={previewDrawOpts}
                            speed={previewVariation?.speed ?? 1}
                            loopStart={previewLoop.start}
                            loopEnd={previewLoop.end}
                          />
                        }
                      />
                    ) : (
                      <div className="relative mx-auto w-full max-w-[320px]">
                        <TemplateCanvas
                          template={previewTemplate}
                          interactive={false}
                          poster={selected.poster}
                          previewFile={selected.file}
                          drawOpts={previewDrawOpts}
                          speed={previewVariation?.speed ?? 1}
                          loopStart={previewLoop.start}
                          loopEnd={previewLoop.end}
                          videoRef={previewVideoRef}
                        />
                        {cropTune && (
                          <PreviewCropOverlay
                            pre={selected.preEdit ?? defaultPreEdit()}
                            videoRef={previewVideoRef}
                            onChange={(next) =>
                              setItems((p) =>
                                p.map((x) => (x.id === selected.id ? { ...x, preEdit: next } : x)),
                              )
                            }
                            onReset={() =>
                              setItems((p) =>
                                p.map((x) =>
                                  x.id === selected.id
                                    ? { ...x, preEdit: { ...(x.preEdit ?? defaultPreEdit()), crop: null, keys: [] } }
                                    : x,
                                ),
                              )
                            }
                          />
                        )}
                      </div>

                    )}
                    {/* estilo rápido de legenda direto na prévia */}
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setActive((t) => ({
                            ...t,
                            captions: {
                              ...(t.captions ?? defaultCaptions()),
                              visible: !(t.captions ?? defaultCaptions()).visible,
                            },
                          }))
                        }
                        className={`rounded-md border px-2 py-1 font-mono text-[10px] ${
                          capStyle.visible
                            ? "border-primary/60 bg-primary/15 text-primary"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        legenda {capStyle.visible ? "on" : "off"}
                      </button>
                      {CAPTION_PRESETS.slice(0, 6).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            setActive((t) => ({
                              ...t,
                              captions: { ...(t.captions ?? defaultCaptions()), ...p.style, visible: true },
                            }))
                          }
                          className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary/60 hover:text-foreground"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    {previewVariation && (

                      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                        {variants > 1 ? `v${variantIdx + 1} · ` : ""}
                        {describeVariation(previewVariation)}
                        {previewCues?.length
                          ? selected.captions?.length
                            ? " · legendas reais"
                            : " · legenda de exemplo (gere a transcrição)"
                          : ""}
                        {" · idêntico ao arquivo exportado"}
                      </p>
                    )}
                  </div>



                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Selecione um vídeo na lista.</p>
              )}

              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void processAll()} disabled={running}>
                    <Play className="size-4" /> {running ? "Processando…" : "Processar em lote"}
                  </Button>
                  {running && (
                    <>
                      <Button variant="outline" onClick={togglePause}>
                        <Pause className="size-4" /> {paused ? "Retomar" : "Pausar"}
                      </Button>
                      <Button variant="outline" onClick={cancelAll}>
                        <StopCircle className="size-4" /> Cancelar
                      </Button>
                    </>
                  )}
                  {errorCount > 0 && !running && (
                    <Button variant="outline" onClick={retryErrors}>
                      <RotateCcw className="size-4" /> Tentar de novo ({errorCount})
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => void downloadZipAll()} disabled={readyCount === 0 || zipping}>
                    <FileArchive className="size-4" /> {zipping ? "Compactando…" : `Baixar ZIP (${readyCount})`}
                  </Button>
                  {fsAccessSupported() && (
                    <Button variant="outline" onClick={() => void saveFolder()} disabled={readyCount === 0}>
                      <FolderDown className="size-4" /> Salvar na pasta
                    </Button>
                  )}
                </div>

                {/* progresso detalhado do lote */}
                {(running || batchItems.length > 0) && (
                  <div className="space-y-1.5 rounded-xl border border-border bg-surface-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="mono-label">Progresso do lote</p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {batchDone}/{batchItems.length} arquivos · {Math.round(batchProgress * 100)}%
                      </p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.round(batchProgress * 100)}%` }}
                      />
                    </div>
                    {activeItem && (
                      <>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {activeItem.file.name} · {activeItem.stage ?? "processando"}
                          {activeItem.stepTotal
                            ? ` (etapa ${activeItem.stepIndex}/${activeItem.stepTotal})`
                            : ""}
                          {` · ${Math.round(activeItem.progress * 100)}%`}
                        </p>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-warn transition-all"
                            style={{ width: `${Math.round(activeItem.progress * 100)}%` }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* relatório do lote */}
                {report && !running && (
                  <div className="space-y-1 rounded-xl border border-border bg-surface-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="mono-label">Relatório do lote</p>
                      <button
                        type="button"
                        onClick={() => setReport(null)}
                        className="font-mono text-[10px] text-muted-foreground hover:text-foreground"
                      >
                        fechar
                      </button>
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {report.ok} vídeo(s) exportado(s) · {report.fail} com erro · {report.seconds}s
                    </p>
                    {report.fails.length > 0 && (
                      <ul className="max-h-24 space-y-0.5 overflow-auto">
                        {report.fails.map((f, i) => (
                          <li key={`${f.name}-${i}`} className="font-mono text-[10px] text-destructive">
                            {f.name}: {f.error}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}



                {/* entrega — cada ferramenta tem a sua própria saída */}
                <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="mono-label">{flow.export.title}</p>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {flow.export.platforms
                        ? `${platforms.length} formato${platforms.length > 1 ? "s" : ""} × ${Math.max(1, flow.export.variants ? variants : 1)} variação${flow.export.variants && variants > 1 ? "ões" : ""} = ${platforms.length * Math.max(1, flow.export.variants ? variants : 1)} arquivos por vídeo`
                        : "1 arquivo por vídeo · resolução e proporção originais"}
                    </span>
                  </div>
                  <div className={`flex-wrap gap-2 ${flow.export.platforms ? "flex" : "hidden"}`}>
                    {PLATFORM_PRESETS.map((p) => {
                      const on = platforms.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          disabled={running}
                          onClick={() => togglePlatform(p.id)}
                          className={`rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                            on ? "border-primary bg-primary/15" : "border-border hover:border-primary/50"
                          }`}
                        >
                          <span className={`block text-xs font-semibold ${on ? "text-primary" : "text-foreground"}`}>
                            {p.label}
                          </span>
                          <span className="block font-mono text-[10px] text-muted-foreground">{p.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={autoBitrate}
                      disabled={running}
                      onChange={(e) => setAutoBitrate(e.target.checked)}
                      className="accent-[var(--primary)]"
                    />
                    usar bitrate recomendado de cada plataforma
                  </label>
                </div>



                <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted-foreground">
                  <label className="flex items-center gap-2">
                    paralelo
                    <input
                      type="range"
                      min={1}
                      max={4}
                      value={concurrency}
                      disabled={running}
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                      className="w-24 accent-[var(--primary)]"
                    />
                    {concurrency}x
                  </label>
                  <label className={`flex items-center gap-2 ${autoBitrate ? "opacity-50" : ""}`}>
                    bitrate
                    <input
                      type="range"
                      min={4}
                      max={20}
                      value={bitrate}
                      disabled={running || autoBitrate}
                      onChange={(e) => setBitrate(Number(e.target.value))}
                      className="w-24 accent-[var(--primary)]"
                    />
                    {autoBitrate ? "auto (preset)" : `${bitrate} Mbps`}

                  </label>
                  <label className={`items-center gap-2 ${flow.export.variants ? "flex" : "hidden"}`}>
                    variações
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={variants}
                      disabled={running}
                      onChange={(e) => setVariants(Number(e.target.value))}
                      className="w-24 accent-[var(--primary)]"
                    />
                    {variants}x por vídeo
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={smartFrame}
                      onChange={(e) => setSmartFrame(e.target.checked)}
                      className="accent-[var(--primary)]"
                    />
                    <Sparkles className="size-3" /> enquadramento inteligente
                  </label>
                  <span>{webCodecsSupported() ? "MP4 H.264 · WebCodecs" : "WebM (fallback)"}</span>
                  {eta && <span className="text-primary">● restam ~{eta}</span>}
                </div>

                {selected && mode !== "limpar" && (
                  <div className="rounded-xl border border-border bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="mono-label">Legendas automáticas</p>
                      <div className="flex items-center gap-2">
                        <select
                          value={capLang}
                          onChange={(e) => setCapLang(e.target.value)}
                          className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
                        >
                          <option value="pt">pt</option>
                          <option value="en">en</option>
                          <option value="es">es</option>
                          <option value="">auto</option>
                        </select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!!capBusyId}
                          onClick={() => void makeCaptions(selected)}
                        >
                          <Captions className="mr-1 size-4" />
                          {capBusyId === selected.id ? "Transcrevendo…" : "Gerar legendas"}
                        </Button>
                      </div>
                    </div>
                    {selected.capError ? (
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2">
                        <AlertTriangle className="mt-[2px] size-3.5 shrink-0 text-destructive" />
                        <div className="space-y-1">
                          <p className="font-mono text-[11px] leading-relaxed text-destructive">{selected.capStatus}</p>
                          <button
                            type="button"
                            className="font-mono text-[10px] underline underline-offset-2 text-muted-foreground hover:text-foreground"
                            onClick={() => void makeCaptions(selected)}
                          >
                            tentar novamente
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                        {selected.capStatus ?? "transcreve a fala e desenha no estilo escolhido abaixo."}
                      </p>
                    )}

                    {!!selected.captions?.length && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="font-mono text-[11px] text-primary">
                          ● {selected.captions.length} blocos prontos
                        </span>
                        <button
                          className="font-mono text-[11px] text-muted-foreground underline"
                          onClick={() =>
                            setItems((p) =>
                              p.map((x) =>
                                x.id === selected.id ? { ...x, captions: undefined, capStatus: undefined } : x,
                              ),
                            )
                          }
                        >
                          remover
                        </button>
                        <button
                          className="font-mono text-[11px] text-muted-foreground underline"
                          onClick={() =>
                            downloadBlob(
                              new Blob([cuesToSrt(selected.captions!)], { type: "text/plain" }),
                              `${selected.file.name.replace(/\.[^.]+$/, "")}.srt`,
                            )
                          }
                        >
                          baixar .srt
                        </button>
                        <button
                          className="font-mono text-[11px] text-muted-foreground underline"
                          onClick={() => void navigator.clipboard.writeText(cuesToText(selected.captions!))}
                        >
                          <Copy className="inline size-3" /> copiar texto
                        </button>
                      </div>
                    )}

                    {!!selected.captions?.length && (
                      <div className="mt-3 border-t border-border pt-3">
                        <p className="mono-label mb-2">Timeline · ajuste palavra por palavra</p>
                        <CaptionTimeline
                          file={selected.file}
                          cues={selected.captions}
                          onChange={(cues) =>
                            setItems((p) => p.map((x) => (x.id === selected.id ? { ...x, captions: cues } : x)))
                          }
                        />
                      </div>
                    )}


                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                      <p className="mono-label">Estilo das legendas (CapCut)</p>
                      <label className="flex items-center gap-2 font-mono text-[11px]">
                        <input
                          type="checkbox"
                          checked={(active.captions ?? defaultCaptions()).visible}
                          onChange={(e) =>
                            setActive((t) => ({
                              ...t,
                              captions: { ...(t.captions ?? defaultCaptions()), visible: e.target.checked },
                            }))
                          }
                          className="size-4 accent-[var(--primary)]"
                        />
                        exibir no vídeo
                      </label>
                    </div>
                    <label className="mt-2 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={autoCap}
                        onChange={(e) => setAutoCap(e.target.checked)}
                        className="size-4 accent-[var(--primary)]"
                      />
                      transcrever automaticamente ao clicar em Processar
                    </label>

                    <div className="mt-3">
                      <CaptionStudio
                        style={active.captions ?? defaultCaptions()}
                        cues={selected.captions}
                        fonts={active.fonts}
                        onAddFont={(f) =>
                          setActive((t) => ({ ...t, fonts: [...(t.fonts ?? []), f] }))
                        }
                        onChange={(patch) =>
                          setActive((t) => ({
                            ...t,
                            captions: { ...(t.captions ?? defaultCaptions()), ...patch },
                          }))
                        }
                      />
                    </div>
                  </div>

                )}


                {selected && mode !== "limpar" && (
                  <div className="rounded-xl border border-border bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="mono-label">Cortes automáticos</p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={clipBusy}
                        onClick={() => void autoClip(selected)}
                      >
                        <Scissors className="mr-1 size-4" />
                        {clipBusy ? "analisando..." : "Gerar cortes"}
                      </Button>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="font-mono text-[11px] text-muted-foreground">
                        duração mínima · {clipMinLen}s
                        <input
                          type="range"
                          min={5}
                          max={120}
                          step={5}
                          value={clipMinLen}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setClipMinLen(v);
                            if (v > clipMaxLen) setClipMaxLen(v);
                          }}
                          className="w-full accent-[var(--primary)]"
                        />
                      </label>
                      <label className="font-mono text-[11px] text-muted-foreground">
                        duração máxima · {clipMaxLen}s
                        <input
                          type="range"
                          min={5}
                          max={120}
                          step={5}
                          value={clipMaxLen}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setClipMaxLen(v);
                            if (v < clipMinLen) setClipMinLen(v);
                          }}
                          className="w-full accent-[var(--primary)]"
                        />
                      </label>
                      <label className="font-mono text-[11px] text-muted-foreground">
                        quantidade de cortes · até {clipMax}
                        <input
                          type="range"
                          min={1}
                          max={20}
                          step={1}
                          value={clipMax}
                          onChange={(e) => setClipMax(Number(e.target.value))}
                          className="w-full accent-[var(--primary)]"
                        />
                      </label>
                      <label className="font-mono text-[11px] text-muted-foreground">
                        intensidade do score · {clipMinScore}
                        <input
                          type="range"
                          min={0}
                          max={95}
                          step={5}
                          value={clipMinScore}
                          onChange={(e) => setClipMinScore(Number(e.target.value))}
                          className="w-full accent-[var(--primary)]"
                        />
                        <span className="block text-[10px] opacity-70">
                          {clipMinScore >= 80
                            ? "só os trechos mais fortes"
                            : clipMinScore >= 60
                              ? "equilibrado"
                              : "aceita quase tudo"}
                        </span>
                      </label>
                    </div>

                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {selected.clip
                        ? `trecho ${formatTime(selected.clip.start)}–${formatTime(selected.clip.end)}${
                            selected.score ? ` · score ${selected.score}` : ""
                          }`
                        : "analisa áudio e movimento e separa os melhores trechos do vídeo longo"}
                    </p>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="mono-label">Anti-duplicidade</p>
                    <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={antiDup.auto}
                        onChange={(e) => setAntiDup({ auto: e.target.checked })}
                        className="accent-[var(--primary)]"
                      />
                      {antiDup.auto ? "randomizar por vídeo" : "manual (valor exato)"}
                    </label>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(
                      [
                        ["brightness", "brilho", 0.15, "pct"],
                        ["saturation", "saturação", 0.2, "pct"],
                        ["zoom", "zoom", 0.12, "pct"],
                        ["trim", "corte início/fim", 1, "s"],
                        ["noise", "ruído", 0.12, "pct"],
                        ["rotate", "rotação", 1.5, "deg"],
                        ["border", "moldura", 40, "px"],
                        ["pitch", "tom do áudio", 60, "cents"],
                        ["eq", "equalização", 4, "db"],
                      ] as const
                    ).map(([key, label, max, unit]) => (
                      <label key={key} className="font-mono text-[11px] text-muted-foreground">
                        {label} ·{" "}
                        {unit === "pct"
                          ? `${(antiDup[key] * 100).toFixed(0)}%`
                          : unit === "s"
                            ? `${antiDup[key].toFixed(2)}s`
                            : unit === "deg"
                              ? `${antiDup[key].toFixed(2)}°`
                              : unit === "px"
                                ? `${Math.round(antiDup[key])}px`
                                : unit === "db"
                                  ? `${antiDup[key].toFixed(1)}dB`
                                  : `${Math.round(antiDup[key])} cents`}
                        <input
                          type="range"
                          min={0}
                          max={max}
                          step={max / 50}
                          value={antiDup[key]}
                          onChange={(e) => setAntiDup({ [key]: Number(e.target.value) })}
                          className="w-full accent-[var(--primary)]"
                        />
                      </label>
                    ))}
                  </div>
                  <label className="mt-2 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={antiDup.cleanMetadata}
                      onChange={(e) => setAntiDup({ cleanMetadata: e.target.checked })}
                      className="accent-[var(--primary)]"
                    />
                    limpar metadados do MP4 (datas e identificadores)
                  </label>
                  {selected && (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      este vídeo: {describeVariation(variationOf(selected))}
                    </p>
                  )}

                </div>

              </div>

            </section>

            <section className="panel flex max-h-[70vh] flex-col p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-semibold">Vídeos ({items.length})</p>
                <button
                  className="font-mono text-xs text-destructive"
                  onClick={() => {
                    setItems([]);
                    setSelectedId(null);
                  }}
                >
                  limpar todos
                </button>
              </div>
              <div className="space-y-2 overflow-y-auto pr-1">
                {items.map((it, i) => (
                  <button
                    key={it.id}
                    onClick={() => setSelectedId(it.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left ${
                      selectedId === it.id ? "border-primary bg-accent/40" : "border-border bg-surface-2"
                    }`}
                  >
                    {it.poster ? (
                      <img src={it.poster} alt="" className="h-14 w-10 rounded-md object-cover" />
                    ) : (
                      <div className="h-14 w-10 rounded-md bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-mono text-xs text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </span>{" "}
                        {it.file.name}
                      </p>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {it.w && it.h ? `${it.w}×${it.h}` : "…"} · {it.duration ? `${it.duration.toFixed(0)}s` : "…"}
                        {it.clip ? ` · corte ${formatTime(it.clip.start)}` : ""}
                        {it.score ? ` · ${it.score}` : ""}
                        {hasPreEdit(it.preEdit) ? " · editado" : ""}

                      </p>
                      <p
                        className={`font-mono text-[11px] ${
                          it.status === "pronto"
                            ? "text-primary"
                            : it.status === "erro"
                              ? "text-destructive"
                              : it.status === "processando"
                                ? "text-warn"
                                : "text-muted-foreground"
                        }`}
                      >
                        ● {it.status}
                        {it.status === "processando" ? ` ${Math.round(it.progress * 100)}%` : ""}
                        {it.stage && it.status !== "pendente" ? ` · ${it.stage}` : ""}
                      </p>
                      {mode === "limpar" && it.detectStatus && (
                        <p
                          className={`font-mono text-[10px] ${
                            it.detectStatus === "ok"
                              ? "text-primary"
                              : it.detectStatus === "erro"
                                ? "text-destructive"
                                : "text-muted-foreground"
                          }`}
                        >
                          {it.detectStatus === "analisando"
                            ? (it.detectMsg ?? "analisando…")
                            : it.detectStatus === "ok"
                              ? `${(it.regions ?? []).length} área(s) detectada(s)`
                              : it.detectStatus === "vazio"
                                ? "nada encontrado — marque manual"
                                : `falha na análise`}
                        </p>
                      )}
                      {(it.status === "processando" || it.status === "na fila") && (
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-warn transition-all"
                            style={{ width: `${Math.round(it.progress * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                    {it.blob && (
                      <span
                        role="button"
                        tabIndex={0}
                        title={
                          (it.outputs?.length ?? 1) > 1 ? `baixar ${it.outputs!.length} variações` : "baixar"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          const base = it.file.name.replace(/\.\w+$/, "");
                          const outs = it.outputs ?? [{ blob: it.blob!, ext: it.ext ?? "mp4", label: "" }];
                          outs.forEach((o, k) =>
                            setTimeout(
                              () => downloadBlob(o.blob, `${base}-vv${o.label ? `-${o.label}` : ""}.${o.ext}`),
                              k * 250,
                            ),
                          );
                        }}
                        className="relative rounded-md border border-border p-1.5 hover:border-primary"
                      >
                        <Download className="size-3.5" />
                        {(it.outputs?.length ?? 1) > 1 && (
                          <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 font-mono text-[9px] text-primary-foreground">
                            {it.outputs!.length}
                          </span>
                        )}
                      </span>
                    )}

                    <span
                      role="button"
                      tabIndex={0}
                      title="Editar vídeo (cortar, enquadrar, cor)"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(it.id);
                        setStudioId(it.id);
                      }}
                      className={`rounded-md border p-1.5 hover:border-primary ${
                        hasPreEdit(it.preEdit) || it.clip ? "border-primary text-primary" : "border-border text-muted-foreground"
                      }`}
                    >
                      <Wand2 className="size-3.5" />
                    </span>

                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItemWithUndo(it.id);
                      }}
                      className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        <footer className="py-8 text-center font-mono text-xs text-muted-foreground">
          tudo roda no navegador · nenhum vídeo sai da sua máquina
        </footer>
      </div>

      {editing && (
        <TemplateEditor
          value={active}
          onCancel={() => setEditing(false)}
          onUse={(t) => {
            setActive(t);
            setEditing(false);
          }}
          onSave={(t) => {
            commit(t, "editado no editor");
            setEditing(false);
          }}
        />
      )}

      {libraryOpen && (
        <TemplateLibrary
          templates={templates}
          activeId={active.id}
          onClose={() => setLibraryOpen(false)}
          onChangeList={setTemplates}
          onUse={(t) => {
            useTemplate(t);
            setLibraryOpen(false);
          }}

          onCommit={commit}
        />
      )}

      {studioItem && (
        <VideoStudio
          file={studioItem.file}
          width={studioItem.w}
          height={studioItem.h}
          duration={studioItem.duration}
          value={{
            pre: studioItem.preEdit ?? defaultPreEdit(),
            clip: studioItem.clip ?? null,
          }}
          captions={studioItem.captions}
          onCaptionsChange={(cues) =>
            setItems((p) => p.map((x) => (x.id === studioItem.id ? { ...x, captions: cues } : x)))
          }
          texts={{
            headline: studioItem.headline || active.headline.text,
            name: active.name_.text,
            handle: active.handle.text,
            cta: active.cta.text,
          }}
          onTextsChange={(t) => {
            setItems((p) => p.map((x) => (x.id === studioItem.id ? { ...x, headline: t.headline } : x)));
            setActive((tpl) => ({
              ...tpl,
              name_: { ...tpl.name_, text: t.name },
              handle: { ...tpl.handle, text: t.handle },
              cta: { ...tpl.cta, text: t.cta },
            }));
          }}
          onClose={() => setStudioId(null)}

          onSave={({ pre, clip }) => {
            setItems((p) =>
              p.map((x) =>
                x.id === studioItem.id
                  ? { ...x, preEdit: pre, clip: clip ?? undefined, status: "pendente", progress: 0 }
                  : x,
              ),
            );
            setStudioId(null);
            toast.success("Edição aplicada — vale no preview e na exportação");
          }}
        />
      )}

      {cloudOpen && (
        <CloudPanel
          templates={templates}
          onClose={() => setCloudOpen(false)}
          onChangeList={setTemplates}
          mode={mode}
          buildSnapshot={buildSnapshot}
          onRestore={restoreSnapshot}
        />
      )}
    </AppShell>
  );
}
