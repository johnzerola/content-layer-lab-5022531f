import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { cleanerRegionSchema } from "./cleaner.schemas";

export const getCleanerHealth = createServerFn({ method: "GET" })
  .handler(async () => {
    const workerUrl = process.env['CLEANER_WORKER_URL'];
    const publicWorkerUrl = process.env['CLEANER_WORKER_PUBLIC_URL'] || workerUrl;
    
    if (!workerUrl) return { status: "offline", reason: "CLEANER_WORKER_URL missing" };

    try {
      const secret = process.env['CLEANER_WORKER_SECRET'];
      const resp = await fetch(`${workerUrl}/v1/health`, {
        headers: secret ? { "X-Service-Token": secret } : {},
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
          cpu: data.cpu || "none",
          uploadUrl: publicWorkerUrl ? `${publicWorkerUrl}/v1/media/upload` : null
        };
      } catch {
        return { status: "offline", reason: "Invalid JSON response" };
      }
    } catch (err) {
      return { status: "offline", reason: "Connection failed" };
    }
  });

export const confirmCleanerUpload = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({
    fileName: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    const workerUrl = process.env['CLEANER_WORKER_URL'];
    const secret = process.env['CLEANER_WORKER_SECRET'];
    
    if (!workerUrl || !secret) throw new Error("Config missing");

    const resp = await fetch(`${workerUrl}/v1/media/exists?file=${encodeURIComponent(data.fileName)}`, {
      headers: { "X-Service-Token": secret }
    });

    if (!resp.ok) return { exists: false };
    const result = await resp.json();
    return { exists: result.exists, videoUrl: result.url };
  });

export const cleanupCleanerRemoteJob = createServerFn({ method: "POST" })
  .validator((data: unknown) => z.object({
    jobId: z.string(),
  }).parse(data))
  .handler(async ({ data }) => {
    const workerUrl = process.env['CLEANER_WORKER_URL'];
    const secret = process.env['CLEANER_WORKER_SECRET'];
    if (!workerUrl || !secret) return;

    await fetch(`${workerUrl}/v1/jobs/${data.jobId}`, {
      method: "DELETE",
      headers: { "X-Service-Token": secret }
    }).catch(() => {});
    
    return { success: true };
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

    const resolveEndpoint = `${workerUrl}/v1/media/resolve`;
    const resolveResp = await fetch(resolveEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
        "X-Service-Token": secret,
        "X-Access-Key": secret,
      },
      body: JSON.stringify({ url: data.videoUrl }),
    });

    if (!resolveResp.ok) {
      const errorText = await resolveResp.text();
      throw new Error(`Media resolution failed: ${errorText.slice(0, 100)}`);
    }

    const { job_id } = await resolveResp.json();

    const processEndpoint = `${workerUrl}/v1/jobs/${job_id}/process`;
    const processResp = await fetch(processEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
        "X-Job-Token": secret,
        "X-Access-Key": secret,
      },
      body: JSON.stringify({
        mode: data.options.mode,
        preset: data.options.preset || "quality",
        masks: data.regions,
        options: {
          upscale: data.options.upscale,
        },
      }),
    });

    if (!processResp.ok) {
      const errorText = await processResp.text();
      throw new Error(`Process start failed: ${errorText.slice(0, 100)}`);
    }

    return { job_id };
  });
