import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { drawFrame } from "./draw";
import { CANVAS_H, CANVAS_W, type Template } from "./template";
import type { Variation } from "./variation";
import type { CaptionCue } from "./captions";
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
  /** legendas em tempo do vídeo fonte */
  captions?: CaptionCue[] | undefined;
  onProgress?: ((p: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
};


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
    await new Promise<void>((res, rej) => {
      video.onloadedmetadata = () => res();
      video.onerror = () => rej(new Error("Não foi possível ler o vídeo"));
    });

    const clipStart = Math.max(0, Math.min(opts.clip?.start ?? 0, Math.max(0, video.duration - 0.5)));
    const clipEnd = Math.min(video.duration, opts.clip?.end ?? video.duration);
    const clipDur = Math.max(0.5, clipEnd - clipStart);
    const trimStart = clipStart + Math.min(v.trimStart, Math.max(0, clipDur - 0.5));
    const effDur = Math.max(0.2, clipDur - (trimStart - clipStart) - v.trimEnd);
    const outDur = effDur / v.speed;
    const totalFrames = Math.max(1, Math.round(outDur * fps));

    const audio = await decodeAudio(opts.file, trimStart, effDur, v.speed, v.pitch, v.eq);
    const audioCodec = audio ? await pickAudioCodec(audio.channels, audio.sampleRate) : null;

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: picked.mux, width: W, height: H, frameRate: fps },
      ...(audio && audioCodec
        ? { audio: { codec: audioCodec, numberOfChannels: audio.channels, sampleRate: audio.sampleRate } }
        : {}),
      fastStart: "in-memory",
    });

    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error(e),
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
      ...(opts.captions?.length ? { captions: opts.captions } : {}),
    };

    let frameIndex = 0;
    const frameDur = Math.round(1_000_000 / fps);

    const emit = async () => {
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
      if (encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const seekTo = (time: number) =>
      new Promise<void>((res) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          video.onseeked = null;
          res();
        };
        video.onseeked = finish;
        video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 1 / 1000));
        // segurança: se o navegador não disparar seeked, segue em frente
        setTimeout(finish, 400);
      });

    // Vídeos longos ou com reconstrução (limpeza) não acompanham a leitura em
    // tempo real: o quadro fonte não avança na mesma velocidade do encoder e o
    // resultado sai travado/repetido. Nesses casos percorremos quadro a quadro.
    const heavy = (t.cleanup?.length ?? 0) > 0 || outDur > 40;

    video.currentTime = trimStart;
    await new Promise<void>((res) => {
      video.onseeked = () => res();
    });

    if (heavy) {
      while (frameIndex < totalFrames) {
        if (opts.signal?.aborted) throw new DOMException("cancelado", "AbortError");
        await seekTo(trimStart + (frameIndex / fps) * v.speed);
        await emit();
        if (frameIndex % 5 === 0) opts.onProgress?.(Math.min(0.97, frameIndex / totalFrames));
      }
    } else {
      video.playbackRate = Math.max(1, Math.min(opts.turbo ?? 4, 16));
      const endAt = trimStart + effDur;
      await video.play();

      await new Promise<void>((resolve, reject) => {
        let stopped = false;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          video.pause();
          resolve();
        };
        const step = async () => {
          if (stopped) return;
          if (opts.signal?.aborted) {
            stopped = true;
            video.pause();
            reject(new DOMException("cancelado", "AbortError"));
            return;
          }
          const outT = (video.currentTime - trimStart) / v.speed;
          // se o desenho não acompanha, reduz a leitura em vez de repetir quadros
          const lag = outT - frameIndex / fps;
          if (lag > 0.35) video.playbackRate = Math.max(1, video.playbackRate * 0.8);
          if (frameIndex < totalFrames && frameIndex / fps <= outT) {
            await emit();
          }
          opts.onProgress?.(Math.min(0.97, frameIndex / totalFrames));
          if (video.currentTime >= endAt || video.ended || frameIndex >= totalFrames) return stop();
          if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => void step());
          else setTimeout(() => void step(), 0);
        };
        video.onended = () => void step();
        void step();
      });

      // completa quadros faltantes com busca precisa (evita congelar no fim)
      while (frameIndex < totalFrames) {
        await seekTo(trimStart + (frameIndex / fps) * v.speed);
        await emit();
      }
    }


    await encoder.flush();
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
