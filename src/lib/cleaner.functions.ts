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
      mode: z.enum(["auto", "manual"]),
      upscale: z.boolean().optional(),
    }),
  }).parse(data))
  .handler(async ({ data }) => {
    const workerUrl = process.env['CLEANER_WORKER_URL'];
    const secret = process.env['CLEANER_WORKER_SECRET'];

    if (!workerUrl || !secret) {
      throw new Error("Cleaner configuration missing");
    }

    const resp = await fetch(`${workerUrl}/v1/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify(data),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Worker error: ${errorText.slice(0, 100)}`);
    }

    return resp.json();
  });

