/**
 * AI Video Cleaner — tipos compartilhados entre o app (frontend + server fns)
 * e o worker Python com GPU (`worker/`).
 *
 * O app NUNCA processa o vídeo: ele cria o job, envia o arquivo direto para o
 * worker, desenha/edita máscaras e acompanha o progresso real. Todo o
 * pipeline (detecção de texto, tracking temporal, ProPainter, refino,
 * validação e FFmpeg) roda no worker.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export type CleanerMode =
  "smart" | "subtitle" | "text" | "watermark" | "logo" | "object" | "passerby";
export type CleanerPreset = "fast" | "quality" | "max";

export type CleanerStatus =
  | "queued"
  | "uploaded"
  | "uploading"
  | "analyzing"
  | "detecting"
  | "tracking"
  | "processing"
  | "inpainting"
  | "refining"
  | "encoding"
  | "completed"
  | "failed";

export const CLEANER_STAGES: CleanerStatus[] = [
  "queued",
  "uploaded",
  "analyzing",
  "detecting",
  "tracking",
  "processing",
  "inpainting",
  "refining",
  "encoding",
  "completed",
];

export const STAGE_LABEL: Record<CleanerStatus, string> = {
  queued: "na fila",
  uploaded: "enviado",
  uploading: "enviando",
  analyzing: "analisando",
  detecting: "detectando",
  tracking: "rastreando",
  processing: "processando",
  inpainting: "reconstruindo",
  refining: "refinando",
  encoding: "codificando",
  completed: "concluído",
  failed: "falhou",
};

export const MODE_LABEL: Record<CleanerMode, string> = {
  smart: "Smart",
  subtitle: "Legenda",
  text: "Texto",
  watermark: "Marca d'água",
  logo: "Logo",
  object: "Objeto",
  passerby: "Passante",
};

export const MODE_HINT: Record<CleanerMode, string> = {
  smart: "detecta legenda, texto e marca d'água de uma vez",
  subtitle: "detector de texto queimado + estabilização temporal da máscara",
  text: "qualquer texto sobreposto, em qualquer posição da tela",
  watermark: "detecta também alpha blending de marca semitransparente",
  logo: "blob de cor/forma persistente, inclusive logo animado",
  object: "seleção manual + rastreamento por optical flow",
  passerby: "remove pessoas ou objetos que cruzam a cena",
};

export const PRESET_LABEL: Record<CleanerPreset, string> = {
  fast: "Rápido",
  quality: "Qualidade",
  max: "Máxima qualidade",
};

export const PRESET_HINT: Record<CleanerPreset, string> = {
  fast: "reconstrução temporal local — prévia rápida",
  quality: "ProPainter oficial em 960 px — equilíbrio recomendado",
  max: "DiffuEraser oficial + prior ProPainter — maior qualidade",
};

/** Retângulo/polígono normalizado (0..1) desenhado pelo usuário ou detectado. */
export interface CleanerRegion {
  id: string;
  /** rect = caixa; poly = polígono; brush = traços de pincel */
  kind: "rect" | "poly" | "brush";
  /** remover o conteúdo, ou proteger a área de qualquer alteração */
  role: "remove" | "protect";
  /** rect */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** poly / brush: pontos normalizados */
  points?: { x: number; y: number }[];
  /** espessura do pincel (fração da largura) */
  size?: number;
  /** dilatação extra em px na resolução original (-8..24) */
  grow?: number;
  /** intervalo de tempo em que essa área vale (vazio = vídeo inteiro) */
  from?: number;
  to?: number;
  /** rastrear ao longo do tempo com optical flow */
  track?: boolean;
  enabled?: boolean;
  label?: string;
  /** confiança quando veio do detector */
  score?: number;
}

export interface CleanerProbe {
  width: number;
  height: number;
  fps: number;
  duration: number;
  codec: string;
  bitrate?: number;
  audio?: string | null;
  rotation?: number;
  hdr?: boolean;
}

export interface CleanerMetrics {
  /** 0..1 — quanto a área reconstruída muda suavemente entre frames */
  temporal_consistency?: number;
  /** nome do device usado (ex: "NVIDIA RTX 4090" ou "cpu") */
  device?: string;
  /** número de frames processados */
  frames?: number;
  /** engine efetiva (diffueraser-official, propainter-official ou temporal-fill) */
  engine?: string;
  /** número de passes executados */
  passes?: number;
}

export interface CleanerJob {
  id: string;
  filename: string;
  size_bytes: number | null;
  mode: CleanerMode;
  preset: CleanerPreset;
  options: Record<string, JsonValue>;
  probe: CleanerProbe | null;
  detections: CleanerRegion[];
  masks: CleanerRegion[];
  status: CleanerStatus;
  stage: string;
  progress: number;
  metrics: CleanerMetrics | null;
  preview_url: string | null;
  result_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function stageIndex(s: CleanerStatus) {
  const i = CLEANER_STAGES.indexOf(s);
  return i < 0 ? 0 : i;
}

export function isRunning(s: CleanerStatus) {
  return s !== "completed" && s !== "failed";
}

export function rid() {
  return Math.random().toString(36).slice(2, 10);
}
