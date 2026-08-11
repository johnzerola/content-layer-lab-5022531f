/**
 * AI Video Cleaner — tipos compartilhados entre o app (frontend + server fns)
 * e o worker Python com GPU (`worker/`).
 *
 * O app NUNCA processa o vídeo: ele cria o job, envia o arquivo direto para o
 * worker, desenha/edita máscaras e acompanha o progresso real. Todo o
 * pipeline (detecção de texto, tracking temporal, ProPainter, refino,
 * validação e FFmpeg) roda no worker.
 */

export type CleanerMode = "subtitle" | "text" | "watermark" | "logo" | "object";
export type CleanerPreset = "fast" | "quality" | "max";

export type CleanerStatus =
  | "queued"
  | "uploading"
  | "analyzing"
  | "detecting"
  | "tracking"
  | "inpainting"
  | "refining"
  | "encoding"
  | "completed"
  | "failed";

export const CLEANER_STAGES: CleanerStatus[] = [
  "queued",
  "analyzing",
  "detecting",
  "tracking",
  "inpainting",
  "refining",
  "encoding",
  "completed",
];

export const STAGE_LABEL: Record<CleanerStatus, string> = {
  queued: "na fila",
  uploading: "enviando",
  analyzing: "analisando",
  detecting: "detectando",
  tracking: "rastreando",
  inpainting: "reconstruindo",
  refining: "refinando",
  encoding: "codificando",
  completed: "concluído",
  failed: "falhou",
};

export const MODE_LABEL: Record<CleanerMode, string> = {
  subtitle: "Legenda",
  text: "Texto",
  watermark: "Marca d'água",
  logo: "Logo",
  object: "Objeto",
};

export const MODE_HINT: Record<CleanerMode, string> = {
  subtitle: "detector de texto queimado + estabilização temporal da máscara",
  text: "qualquer texto sobreposto, em qualquer posição da tela",
  watermark: "detecta também alpha blending de marca semitransparente",
  logo: "blob de cor/forma persistente, inclusive logo animado",
  object: "seleção manual + rastreamento por optical flow",
};

export const PRESET_LABEL: Record<CleanerPreset, string> = {
  fast: "Rápido",
  quality: "Qualidade",
  max: "Máxima qualidade",
};

export const PRESET_HINT: Record<CleanerPreset, string> = {
  fast: "STTN / contexto temporal curto — prévia rápida",
  quality: "ProPainter, contexto padrão — equilíbrio recomendado",
  max: "ProPainter + segundo passe de refino e validação (ou DiffuEraser)",
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
  mask_coverage?: number;
  edge_residue_score?: number;
  temporal_flicker_score?: number;
  temporal_consistency_score?: number;
  reconstruction_confidence?: number;
  passes?: number;
  engine?: string;
}

export interface CleanerJob {
  id: string;
  filename: string;
  size_bytes: number | null;
  mode: CleanerMode;
  preset: CleanerPreset;
  options: Record<string, unknown>;
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
