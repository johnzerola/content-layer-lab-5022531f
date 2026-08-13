import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cleanerRegionSchema } from "./cleaner.schemas";

export const getCleanerHealth = createServerFn({ method: "GET" })
  .handler(async () => {
    const workerUrl = process.env['CLEANER_WORKER_URL'];
    if (!workerUrl) return { status: "offline", reason: "CLEANER_WORKER_URL missing" };

    try {
      const resp = await fetch(`${workerUrl}/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      
      if (!resp.ok) {
        return { status: "offline", reason: "Worker returned error status" };
      }

      const text = await resp.text();
      try {
        const data = JSON.parse(text);
        return { 
          status: data.online ? "online" : "offline", 
          gpu: data.gpu || "none",
          cpu: data.cpu || "none"
        };
      } catch {
        return { status: "offline", reason: "Invalid JSON response" };
      }
    } catch (err) {
      return { status: "offline", reason: "Connection failed" };
    }
  });

export const startCleanerJob = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({
    videoUrl: z.string(),
    regions: z.array(cleanerRegionSchema),
    options: z.object({
      mode: z.enum(["smart", "subtitle", "text", "watermark", "logo", "object", "passerby"]),
      preset: z.enum(["fast", "quality", "max"]).optional(),
      upscale: z.boolean().optional(),
    }),
  }).parse(data))
  .handler(async ({ data }) => {
    const workerUrl = process.env['CLEANER_WORKER_URL'];
    const secret = process.env['CLEANER_WORKER_SECRET'];

    if (!workerUrl || !secret) {
      throw new Error("Cleaner configuration missing");
    }

    // O worker usa um fluxo de duas etapas: 1. Criar Job/Upload, 2. Processar.
    // Primeiro, tentamos resolver a URL para ver se já é conhecida ou criar um novo job de importação.
    const resolveEndpoint = `${workerUrl}/v1/media/resolve`;
    const resolveResp = await fetch(resolveEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify({ url: data.videoUrl }),
    });

    if (!resolveResp.ok) {
      const errorText = await resolveResp.text();
      throw new Error(`Media resolution failed: ${errorText.slice(0, 100)}`);
    }

    const { job_id } = await resolveResp.json();

    // Agora iniciamos o processamento
    const processEndpoint = `${workerUrl}/v1/jobs/${job_id}/process`;
    const processResp = await fetch(processEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify({
        regions: data.regions,
        options: data.options,
      }),
    });

    if (!processResp.ok) {
      const errorText = await processResp.text();
      throw new Error(`Process start failed: ${errorText.slice(0, 100)}`);
    }

    return { job_id };
  });

