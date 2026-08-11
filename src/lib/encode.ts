import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { drawFrame } from "./draw";
import { CANVAS_H, CANVAS_W, type Template } from "./template";
import type { Variation } from "./variation";
import type { CaptionCue } from "./captions";
import type { PreEdit } from "./preedit";
import { cleanMp4Metadata } from "./mp4meta";

export interface EncodeOptions {
  file: File;
  template: Template;
  variation: Variation;
  offsetX: number;
  offsetY: number;
  headline?: string | undefined;
  fps?: number | undefined;
  bitrate?: number | undefined;
  /** aceleração de leitura do vídeo fonte (1 = tempo real) */
  turbo?: number | undefined;
  /** recorte do vídeo fonte (clipagem automática) */
  clip?: { start: number; end: number } | undefined;
  /** pré-edição do vídeo fonte (recorte, giro, cor) */
  pre?: PreEdit | null | undefined;
  /** legendas em tempo do vídeo fonte */
  captions?: CaptionCue[] | undefined;
  /** placa de fundo (mediana temporal) para remover overlays com pixels reais */
  plate?: { canvas: HTMLCanvasElement; ok: Set<string> } | null | undefined;
  onProgress?: ((p: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    cb: (now: number, metadata: { mediaTime: number; presentedFrames: number }) => void,
  ) => number;
};

class RenderStalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderStalledError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new RenderStalledError(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}


export function webCodecsSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.VideoEncoder !== "undefined" &&
    typeof window.VideoFrame !== "undefined"
  );
}

async function pickVideoCodec(width: number, height: number, bitrate: number, framerate: number) {
  const candidates: { codec: string; mux: "avc" | "vp9" }[] = [
    { codec: "avc1.640028", mux: "avc" },
    { codec: "avc1.4d0032", mux: "avc" },
    { codec: "avc1.42003c", mux: "avc" },
    { codec: "avc1.42001f", mux: "avc" },
    // último recurso: VP9 dentro do MP4 (quando o navegador não tem H.264)
    { codec: "vp09.00.10.08", mux: "vp9" },
  ];
  for (const { codec, mux } of candidates) {
    try {
      const cfg: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate,
        latencyMode: "quality",
        ...(mux === "avc" ? { avc: { format: "avc" as const } } : {}),
      };
      const sup = await VideoEncoder.isConfigSupported(cfg);
      if (sup.supported) return { cfg, mux };
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

async function pickAudioCodec(channels: number, sampleRate: number): Promise<"aac" | "opus" | null> {
  const Enc = window.AudioEncoder;
  if (!Enc) return null;
  for (const [mux, codec] of [["aac", "mp4a.40.2"], ["opus", "opus"]] as const) {
    try {
      const sup = await Enc.isConfigSupported({ codec, sampleRate, numberOfChannels: channels, bitrate: 128_000 });
      if (sup.supported) return mux;
    } catch {
      /* próximo */
    }
  }
  return null;
}

async function decodeAudio(
  file: File,
  trimStart: number,
  dur: number,
  speed: number,
  pitchCents = 0,
  eqDb = 0,
) {
  try {
    const buf = await file.arrayBuffer();
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new Ctx();
    const decoded = await ac.decodeAudioData(buf);
    void ac.close();
    if (!decoded.length) return null;

    const sampleRate = 48000;
    const channels = Math.min(2, decoded.numberOfChannels);
    const outLen = Math.max(1, Math.floor((dur / speed) * sampleRate));
    const off = new OfflineAudioContext(channels, outLen, sampleRate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.playbackRate.value = speed;
    // anti-duplicidade: leve alteração de tom (cents) sem mudar a duração de saída
    if (pitchCents) {
      try {
        src.detune.value = pitchCents;
      } catch {
        /* navegador sem detune */
      }
    }

    let node: AudioNode = src;
    if (eqDb) {
      // realce/corte sutil de agudos: muda o fingerprint do áudio sem soar diferente
      const shelf = off.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 5200;
      shelf.gain.value = eqDb;
      node.connect(shelf);
      node = shelf;
    }
    node.connect(off.destination);
    src.start(0, trimStart, dur);
    const rendered = await off.startRendering();
    return { rendered, channels, sampleRate };
  } catch {
    return null;
  }
}

/** Renderiza para MP4 (H.264 + AAC) usando WebCodecs — mais rápido que tempo real. */
export async function encodeMp4(opts: EncodeOptions): Promise<Blob> {
  const fps = opts.fps ?? 30;
  const bitrate = opts.bitrate ?? 10_000_000;
  const t = opts.template;
  const W = t.canvasW ?? CANVAS_W;
  const H = t.canvasH ?? CANVAS_H;
  const v = opts.variation;

  const picked = await pickVideoCodec(W, H, bitrate, fps);
  if (!picked) throw new Error("Codificação de vídeo não suportada neste navegador");
  const videoConfig = picked.cfg;

  const url = URL.createObjectURL(opts.file);
  const video = document.createElement("video") as VideoWithRvfc;
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await withTimeout(
      new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error("Não foi possível ler o vídeo"));
      }),
      15_000,
      "O navegador não conseguiu preparar este vídeo em 15 segundos",
    );

    const clipStart = Math.max(0, Math.min(opts.clip?.start ?? 0, Math.max(0, video.duration - 0.5)));
    const clipEnd = Math.min(video.duration, opts.clip?.end ?? video.duration);
    const clipDur = Math.max(0.5, clipEnd - clipStart);
    const trimStart = clipStart + Math.min(v.trimStart, Math.max(0, clipDur - 0.5));
    const effDur = Math.max(0.2, clipDur - (trimStart - clipStart) - v.trimEnd);
    const outDur = effDur / v.speed;
    const totalFrames = Math.max(1, Math.round(outDur * fps));

    // A leitura do áudio acontece antes do primeiro quadro. Alguns MP4s
    // defeituosos deixam decodeAudioData pendurado indefinidamente; nesse caso
    // continuamos com o vídeo, em vez de deixar o lote parado em 0% por horas.
    opts.onProgress?.(0.005);
    const audio = await withTimeout(
      decodeAudio(opts.file, trimStart, effDur, v.speed, v.pitch, v.eq),
      Math.min(60_000, Math.max(20_000, effDur * 250)),
      "A faixa de áudio não pôde ser preparada",
    ).catch((error) => {
      console.warn("Áudio ignorado para evitar bloqueio da exportação:", error);
      return null;
    });
    const audioCodec = audio ? await pickAudioCodec(audio.channels, audio.sampleRate) : null;

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: picked.mux, width: W, height: H, frameRate: fps },
      ...(audio && audioCodec
        ? { audio: { codec: audioCodec, numberOfChannels: audio.channels, sampleRate: audio.sampleRate } }
        : {}),
      fastStart: "in-memory",
    });

    let encoderError: DOMException | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        encoderError = e;
        console.error(e);
      },
    });
    encoder.configure(videoConfig);

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { alpha: false })!;

    const tpl: Template = opts.headline
      ? { ...t, headline: { ...t.headline, text: opts.headline } }
      : t;

    const drawOpts = {
      mirror: v.mirror,
      offsetX: opts.offsetX,
      offsetY: opts.offsetY,
      brightness: v.brightness,
      saturation: v.saturation,
      zoom: v.zoom,
      noise: v.noise,
      rotate: v.rotate,
      border: v.border,
      borderColor: v.borderColor,
      ...(opts.pre ? { pre: opts.pre, clip: { start: trimStart, end: trimStart + effDur } } : {}),
      ...(opts.captions?.length ? { captions: opts.captions } : {}),
      ...(opts.plate ? { plate: opts.plate } : {}),
    };


    let frameIndex = 0;
    const frameDur = Math.round(1_000_000 / fps);

    let averageFrameMs = 1000 / fps;
    const emit = async () => {
      const startedAt = performance.now();
      // tempo do vídeo fonte correspondente a este frame (legendas sincronizadas)
      const srcTime = trimStart + (frameIndex / fps) * v.speed;
      drawFrame(
        ctx,
        tpl,
        { el: video, width: video.videoWidth, height: video.videoHeight },
        { ...drawOpts, time: srcTime, quality: "hq" as const },
      );
      const frame = new VideoFrame(canvas, {
        timestamp: frameIndex * frameDur,
        duration: frameDur,
      });
      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 });
      frame.close();
      frameIndex++;
      // Não deixe o encoder acumular uma fila grande. Uma fila sem limite faz
      // o desenho continuar enquanto o vídeo fonte avança, provocando saltos
      // que aparecem como congelamentos no MP4 final.
      const queueWaitStarted = performance.now();
      while (encoder.encodeQueueSize > 6) {
        if (encoderError) throw encoderError;
        if (opts.signal?.aborted) throw new DOMException("cancelado", "AbortError");
        if (performance.now() - queueWaitStarted > 15_000) {
          throw new RenderStalledError("O codificador de vídeo parou de responder");
        }
        await new Promise((r) => setTimeout(r, 2));
      }
      // Libera a thread principal regularmente para a barra de progresso e o
      // botão de cancelar continuarem respondendo durante renders pesados.
      if (frameIndex % 4 === 0) await new Promise((r) => setTimeout(r, 0));
      const elapsed = Math.max(0.1, performance.now() - startedAt);
      averageFrameMs = averageFrameMs * 0.85 + elapsed * 0.15;
    };

    /** Espera o navegador realmente apresentar um quadro novo após a busca. */
    const awaitPresented = (ms: number) =>
      new Promise<void>((res) => {
        if (!video.requestVideoFrameCallback) return void setTimeout(res, Math.min(ms, 30));
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          res();
        };
        video.requestVideoFrameCallback(() => finish());
        setTimeout(finish, ms);
      });

    const seekTo = async (time: number) => {
      const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 1 / 1000));
      if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) return;
      await new Promise<void>((res) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          video.onseeked = null;
          res();
        };
        video.onseeked = finish;
        video.currentTime = target;
        // segurança: se o navegador não disparar seeked, segue em frente
        setTimeout(finish, 400);
      });
      // sem isto o canvas pode capturar o quadro anterior, o que aparece como
      // travadas/repetições no arquivo final
      await awaitPresented(120);
    };

    // garante que há um quadro decodificado antes de desenhar (evita
    // primeiros frames pretos/embaralhados no início da exportação)
    if (video.readyState < 2) {
      await new Promise<void>((res) => {
        const done = () => res();
        video.onloadeddata = done;
        setTimeout(done, 3000);
      });
    }
    await seekTo(trimStart);
    await awaitPresented(300);

    // Exportação determinística: cada quadro de saída vem do instante exato do
    // vídeo fonte. É mais lento que a leitura contínua, mas elimina os saltos e
    // repetições que faziam o MP4 baixado parecer travando.
    while (frameIndex < totalFrames) {
      if (opts.signal?.aborted) throw new DOMException("cancelado", "AbortError");
      await seekTo(trimStart + (frameIndex / fps) * v.speed);
      await emit();
      if (frameIndex % 3 === 0) opts.onProgress?.(Math.min(0.97, frameIndex / totalFrames));
    }




    await withTimeout(encoder.flush(), 30_000, "O codificador não conseguiu finalizar o arquivo");
    encoder.close();

    if (audio && audioCodec) {
      const { rendered, channels, sampleRate } = audio;
      const AudioEnc = window.AudioEncoder;
      if (AudioEnc) {
        const aenc = new AudioEnc({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => console.error(e),
        });
        const aConfig: AudioEncoderConfig = {
          codec: audioCodec === "aac" ? "mp4a.40.2" : "opus",
          sampleRate,
          numberOfChannels: channels,
          bitrate: 128_000,
        };
        const sup = await AudioEnc.isConfigSupported(aConfig).catch(() => null);
        if (sup?.supported) {
          aenc.configure(aConfig);
          const chunkSize = 4800;
          const planes: Float32Array[] = [];
          for (let c = 0; c < channels; c++) planes.push(rendered.getChannelData(c));
          for (let off = 0; off < rendered.length; off += chunkSize) {
            const len = Math.min(chunkSize, rendered.length - off);
            const data = new Float32Array(len * channels);
            for (let c = 0; c < channels; c++) data.set(planes[c]!.subarray(off, off + len), c * len);
            const ad = new AudioData({
              format: "f32-planar",
              sampleRate,
              numberOfFrames: len,
              numberOfChannels: channels,
              timestamp: Math.round((off / sampleRate) * 1_000_000),
              data,
            });
            aenc.encode(ad);
            ad.close();
          }
          await aenc.flush();
          aenc.close();
        }
      }
    }

    muxer.finalize();
    opts.onProgress?.(1);
    const raw = muxer.target.buffer as ArrayBuffer;
    const clean = t.antiDup?.cleanMetadata === false ? raw : cleanMp4Metadata(raw);
    return new Blob([clean], { type: "video/mp4" });
  } finally {
    URL.revokeObjectURL(url);
    video.src = "";
  }
}
