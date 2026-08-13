import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyCallback, workerResultUrl } from "@/lib/cleaner.server";

const callbackSchema = z
  .object({
    job_id: z.string().uuid(),
    callback_seq: z.number().int().positive(),
    status: z
      .enum([
        "queued",
        "uploaded",
        "analyzing",
        "detecting",
        "tracking",
        "processing",
        "inpainting",
        "refining",
        "encoding",
        "completed",
        "failed",
      ])
      .optional(),
    stage: z.string().max(160).optional(),
    progress: z.number().min(0).max(100).optional(),
    probe: z.record(z.string(), z.unknown()).optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
    preview_url: z.string().max(500).optional(),
    result_url: z.string().max(500).optional(),
    error: z.string().max(1000).optional(),
    detections: z.array(z.record(z.string(), z.unknown())).max(500).optional(),
    segments: z.array(z.record(z.string(), z.unknown())).max(10000).optional(),
  })
  .strict();

type CallbackPayload = z.infer<typeof callbackSchema>;
const patchKeys = [
  "status",
  "stage",
  "progress",
  "probe",
  "metrics",
  "preview_url",
  "result_url",
  "error",
  "detections",
  "segments",
  "callback_seq",
] as const satisfies readonly (keyof CallbackPayload)[];

/**
 * O worker GPU empurra progresso real aqui (uma chamada por etapa).
 * Autenticado por HMAC-SHA256 do corpo com CLEANER_WORKER_SECRET.
 */
export const Route = createFileRoute("/api/public/cleaner-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        if (body.length > 256 * 1024) return new Response("payload too large", { status: 413 });
        if (
          !verifyCallback(
            body,
            request.headers.get("x-signature"),
            request.headers.get("x-callback-timestamp"),
          )
        ) {
          return new Response("invalid signature", { status: 401 });
        }

        let payload: CallbackPayload;
        try {
          payload = callbackSchema.parse(JSON.parse(body));
        } catch {
          return new Response("invalid payload", { status: 400 });
        }
        const id = payload.job_id;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const patch: Record<string, unknown> = {};
        for (const k of patchKeys) {
          if (payload[k] !== undefined) patch[k] = payload[k];
        }
        if (patch["result_url"]) {
          const signed = workerResultUrl(patch["result_url"]);
          if (!signed) return new Response("invalid result URL", { status: 400 });
          patch["result_url"] = signed;
        }
        if (patch["preview_url"]) {
          const signed = workerResultUrl(patch["preview_url"]);
          if (!signed) return new Response("invalid preview URL", { status: 400 });
          patch["preview_url"] = signed;
        }
        if (!Object.keys(patch).length) return new Response("noop");

        const { error } = await supabaseAdmin
          .from("cleaner_jobs")
          .update(patch as never)
          .eq("id", id)
          .lt("callback_seq", payload.callback_seq);
        if (error) return new Response(error.message, { status: 500 });
        return new Response("ok");
      },
    },
  },
});
