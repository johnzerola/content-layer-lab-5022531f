import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CleanerJob, CleanerRegion } from "@/lib/cleaner";
import {
  jobToken,
  workerBase,
  workerCancel,
  workerDetect,
  workerHealth,
  workerProcess,
  workerStatus,
} from "@/lib/cleaner.server";

const region = z.object({
  id: z.string(),
  kind: z.enum(["rect", "poly", "brush"]),
  role: z.enum(["remove", "protect"]),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  points: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  size: z.number().optional(),
  grow: z.number().optional(),
  from: z.number().optional(),
  to: z.number().optional(),
  track: z.boolean().optional(),
  enabled: z.boolean().optional(),
  label: z.string().optional(),
  score: z.number().optional(),
});

function origin() {
  const req = getRequest();
  const fromEnv = process.env["PUBLIC_SITE_URL"];
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}

export const cleanerHealth = createServerFn({ method: "GET" }).handler(async () => {
  return workerHealth();
});

export const createCleanerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        filename: z.string().min(1),
        size: z.number().nonnegative().default(0),
        mode: z.enum(["subtitle", "text", "watermark", "logo", "object"]).default("subtitle"),
        preset: z.enum(["fast", "quality", "max"]).default("quality"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("cleaner_jobs")
      .insert({
        user_id: context.userId,
        filename: data.filename,
        size_bytes: data.size,
        mode: data.mode,
        preset: data.preset,
        status: "queued",
        stage: "aguardando upload",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    const base = workerBase();
    return {
      job: row as unknown as CleanerJob,
      upload: base ? { url: `${base}/v1/jobs/${row.id}/upload`, token: jobToken(row.id) } : null,
    };
  });

export const listCleanerJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cleaner_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CleanerJob[];
  });

export const deleteCleanerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await workerCancel(data.id).catch(() => null);
    const { error } = await context.supabase.from("cleaner_jobs").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** roda o detector no worker e grava as regiões encontradas no job */
export const detectCleanerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        mode: z.enum(["subtitle", "text", "watermark", "logo", "object"]),
        roi: region.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("cleaner_jobs")
      .update({ status: "detecting", stage: "detectando", progress: 0.05, mode: data.mode })
      .eq("id", data.id);

    const out = await workerDetect(data.id, data.mode, (data.roi as CleanerRegion) ?? null);

    const { data: row, error } = await context.supabase
      .from("cleaner_jobs")
      .update({
        detections: out.regions as unknown as never,
        status: "queued",
        stage: `${out.regions.length} área(s) detectada(s)`,
        progress: 0.1,
      })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as CleanerJob;
  });

export const saveCleanerMasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), masks: z.array(region) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("cleaner_jobs")
      .update({ masks: data.masks as unknown as never })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const processCleanerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        mode: z.enum(["subtitle", "text", "watermark", "logo", "object"]),
        preset: z.enum(["fast", "quality", "max"]),
        masks: z.array(region),
        options: z.record(z.string(), z.any()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await workerProcess({
      jobId: data.id,
      mode: data.mode,
      preset: data.preset,
      masks: data.masks as CleanerRegion[],
      options: data.options,
      callbackUrl: `${origin()}/api/public/cleaner-callback`,
    });

    const { data: row, error } = await context.supabase
      .from("cleaner_jobs")
      .update({
        mode: data.mode,
        preset: data.preset,
        masks: data.masks as unknown as never,
        options: data.options as unknown as never,
        status: "analyzing",
        stage: "analisando",
        progress: 0.02,
        error: null,
        result_url: null,
      })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as CleanerJob;
  });

/** consulta o worker e devolve o estado atualizado (usado no polling) */
export const refreshCleanerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    let patch: Record<string, any> = {};
    try {
      const s = (await workerStatus(data.id)) as Record<string, any>;
      patch = {
        status: s["status"],
        stage: s["stage"],
        progress: s["progress"],
        probe: s["probe"] ?? null,
        metrics: s["metrics"] ?? null,
        preview_url: s["preview_url"] ?? null,
        result_url: s["result_url"] ?? null,
        error: s["error"] ?? null,
      };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
    } catch {
      // worker fora do ar: devolve o que está no banco
    }
    const q = context.supabase.from("cleaner_jobs");
    const { data: row, error } = Object.keys(patch).length
      ? await q.update(patch as never).eq("id", data.id).select("*").single()
      : await q.select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    return row as unknown as CleanerJob;
  });
