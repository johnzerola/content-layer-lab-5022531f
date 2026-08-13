import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Este arquivo é apenas um wrapper. 
 * A lógica de separação de áudio em ambiente Lovable é feita via FFmpeg no cliente
 * por limitações de runtime de edge (workers).
 */

export const getAudioStatus = createServerFn({ method: "GET" })
  .handler(async () => {
    return { status: "ready", engine: "FFmpeg.wasm" };
  });
