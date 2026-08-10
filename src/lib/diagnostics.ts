/**
 * Diagnóstico do navegador: o que o aparelho realmente suporta e por que
 * um export pode cair para WebM em vez de MP4 (H.264).
 */

export interface CapabilityRow {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface Diagnostics {
  rows: CapabilityRow[];
  /** motivo real do fallback para WebM (null = exporta MP4/H.264) */
  fallbackReason: string | null;
  memoryMb: number | null;
  storageMb: { used: number; quota: number } | null;
  cores: number;
  userAgent: string;
}

const H264_CANDIDATES = ["avc1.640028", "avc1.4d0032", "avc1.42001f"];

async function h264Support(): Promise<{ ok: boolean; detail: string }> {
  if (typeof window === "undefined" || typeof window.VideoEncoder === "undefined") {
    return { ok: false, detail: "VideoEncoder indisponível" };
  }
  for (const codec of H264_CANDIDATES) {
    try {
      const sup = await VideoEncoder.isConfigSupported({
        codec,
        width: 1080,
        height: 1920,
        bitrate: 8_000_000,
        framerate: 30,
        avc: { format: "avc" },
      });
      if (sup.supported) return { ok: true, detail: codec };
    } catch {
      /* tenta o próximo */
    }
  }
  return { ok: false, detail: "nenhum perfil H.264 aceito" };
}

function recorderMimes(): string[] {
  if (typeof MediaRecorder === "undefined") return [];
  return [
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].filter((m) => MediaRecorder.isTypeSupported(m));
}

/** Explica em uma frase por que o arquivo final sai em WebM. */
export function explainFallback(rows: CapabilityRow[]): string | null {
  const webcodecs = rows.find((r) => r.id === "webcodecs");
  const h264 = rows.find((r) => r.id === "h264");
  if (webcodecs && !webcodecs.ok) {
    return "Este navegador não tem WebCodecs — o vídeo é gravado em tempo real e sai em WebM. Use Chrome ou Edge atualizados para MP4.";
  }
  if (h264 && !h264.ok) {
    return "WebCodecs existe, mas o sistema não expõe um encoder H.264 — o export cai para VP9/WebM. No Linux, instale os codecs proprietários; no Chrome, verifique a aceleração de hardware.";
  }
  return null;
}

export async function runDiagnostics(): Promise<Diagnostics> {
  const hasWebCodecs =
    typeof window !== "undefined" &&
    typeof window.VideoEncoder !== "undefined" &&
    typeof window.VideoFrame !== "undefined";
  const h264 = hasWebCodecs ? await h264Support() : { ok: false, detail: "sem WebCodecs" };
  const mimes = recorderMimes();
  const fsa = typeof window !== "undefined" && "showSaveFilePicker" in window;
  const audioEnc = typeof window !== "undefined" && typeof window.AudioEncoder !== "undefined";

  const rows: CapabilityRow[] = [
    {
      id: "webcodecs",
      label: "WebCodecs (export rápido)",
      ok: hasWebCodecs,
      detail: hasWebCodecs ? "VideoEncoder + VideoFrame disponíveis" : "indisponível neste navegador",
    },
    { id: "h264", label: "H.264 / MP4", ok: h264.ok, detail: h264.detail },
    {
      id: "aac",
      label: "Áudio AAC/Opus (WebCodecs)",
      ok: audioEnc,
      detail: audioEnc ? "AudioEncoder disponível" : "sem AudioEncoder — áudio pode sair mudo no MP4",
    },
    {
      id: "recorder",
      label: "MediaRecorder (live e fallback)",
      ok: mimes.length > 0,
      detail: mimes.length ? mimes.join(", ") : "nenhum formato suportado",
    },
    {
      id: "fsa",
      label: "Salvar em pasta (File System Access)",
      ok: fsa,
      detail: fsa ? "ZIP grande vai direto para o disco" : "ZIP é montado na memória",
    },
    {
      id: "capture",
      label: "captureStream (gravar a live)",
      ok: typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype,
      detail:
        typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype
          ? "suportado"
          : "indisponível — Monitora Live não grava",
    },
  ];

  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  let storage: { used: number; quota: number } | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) {
      storage = {
        used: Math.round((est.usage ?? 0) / 1e6),
        quota: Math.round(est.quota / 1e6),
      };
    }
  } catch {
    storage = null;
  }

  return {
    rows,
    fallbackReason: explainFallback(rows),
    memoryMb: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null,
    storageMb: storage,
    cores: typeof navigator === "undefined" ? 0 : (navigator.hardwareConcurrency ?? 0),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  };
}
