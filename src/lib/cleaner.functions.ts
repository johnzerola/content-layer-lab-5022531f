import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { CleanerJob, CleanerRegion } from "@/lib/cleaner";
import { cleanerRegionSchema } from "@/lib/cleaner.schemas";
import {
  appOrigin,
  jobToken,
  workerPublicBase,
  workerDelete,
  workerDetect,
  workerHealth,
  workerInputStatus,
  workerProcess,
  workerStatus,
} from "@/lib/cleaner.server";

const configuredMaxUploadGb = Number(process.env["CLEANER_MAX_UPLOAD_GB"] ?? "2");
const maxUploadBytes =
  Math.max(0.05, Number.isFinite(configuredMaxUploadGb) ? configuredMaxUploadGb : 2) * 1024 ** 3;

async function requireOwnedJob(
  supabase: SupabaseClient<Database>,
  userId: string,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("cleaner_jobs")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Job nao encontrado");
}

export const cleanerHealth = createServerFn({ method: "GET" }).handler(async () => {
  const health = await workerHealth();
  return health;
});

export const createCleanerJob = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        filename: z.string().min(1),
        size: z.number().positive().max(maxUploadBytes, "Video excede o limite permitido"),
        mode: z
          .enum(["smart", "subtitle", "text", "watermark", "logo", "object", "passerby"])
          .default("subtitle"),
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

    const base = workerPublicBase();
    return {
      job: row as unknown as CleanerJob,
      upload: base
        ? { url: `${base}/v1/jobs/${row.id}/upload`, token: jobToken(row.id, "upload") }
        : null,
    };
  });

export const listCleanerJobs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cleaner_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CleanerJob[];
  });

export const confirmCleanerUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOwnedJob(context.supabase, context.userId, data.id);
    const input = await workerInputStatus(data.id);
    if (!input.exists || input.size < 1) throw new Error("video nao chegou ao motor; reenvie o arquivo");
    const { data: row, error } = await context.supabase
      .from("cleaner_jobs")
      .update({
        status: "uploaded",
        stage: "enviado e verificado",
        progress: 0,
        probe: (input.probe ?? null) as never,
        error: null,
      })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as CleanerJob;
  });

export const deleteCleanerJob = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOwnedJob(context.supabase, context.userId, data.id);
    await workerDelete(data.id);
    const { error } = await context.supabase
      .from("cleaner_jobs")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const detectCleanerJob = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        mode: z.enum(["smart", "subtitle", "text", "watermark", "logo", "object", "passerby"]),
        roi: cleanerRegionSchema.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwnedJob(context.supabase, context.userId, data.id);
    const { error: updateError } = await context.supabase
      .from("cleaner_jobs")
      .update({ status: "detecting", stage: "detectando", progress: 0.05, mode: data.mode })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (updateError) throw new Error(updateError.message);

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
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as CleanerJob;
  });

export const saveCleanerMasks = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), masks: z.array(cleanerRegionSchema) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwnedJob(context.supabase, context.userId, data.id);
    const { error } = await context.supabase
      .from("cleaner_jobs")
      .update({ masks: data.masks as unknown as never })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const processCleanerJob = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        mode: z.enum(["smart", "subtitle", "text", "watermark", "logo", "object", "passerby"]),
        preset: z.enum(["fast", "quality", "max"]),
        masks: z.array(cleanerRegionSchema),
        options: z.record(z.string(), z.any()).default({}),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireOwnedJob(context.supabase, context.userId, data.id);
    const callbackUrl = `${appOrigin()}/api/public/cleaner-callback`;
    if (!callbackUrl.startsWith("https://")) {
      throw new Error("PUBLIC_SITE_URL HTTPS nao configurada");
    }
    await workerProcess({
      jobId: data.id,
      mode: data.mode,
      preset: data.preset,
      masks: data.masks as CleanerRegion[],
      options: data.options,
      callbackUrl,
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
      .eq("user_id", context.userId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as CleanerJob;
  });

export const refreshCleanerJob = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireOwnedJob(context.supabase, context.userId, data.id);
    let patch: Record<string, unknown> = {};
    try {
      const s = await workerStatus(data.id);
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
      // worker fora do ar
    }
    const q = context.supabase.from("cleaner_jobs");
    const { data: row, error } = Object.keys(patch).length
      ? await q
          .update(patch as never)
          .eq("id", data.id)
          .eq("user_id", context.userId)
          .select("*")
          .single()
      : await q.select("*").eq("id", data.id).eq("user_id", context.userId).single();
    if (error) throw new Error(error.message);
    return row as unknown as CleanerJob;
  });
