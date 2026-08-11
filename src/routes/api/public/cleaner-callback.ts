import { createFileRoute } from "@tanstack/react-router";
import { verifyCallback } from "@/lib/cleaner.server";

/**
 * O worker GPU empurra progresso real aqui (uma chamada por etapa).
 * Autenticado por HMAC-SHA256 do corpo com CLEANER_WORKER_SECRET.
 */
export const Route = createFileRoute("/api/public/cleaner-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        if (!verifyCallback(body, request.headers.get("x-signature"))) {
          return new Response("invalid signature", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(body) as Record<string, unknown>;
        } catch {
          return new Response("bad json", { status: 400 });
        }
        const id = typeof payload["job_id"] === "string" ? payload["job_id"] : null;
        if (!id) return new Response("missing job_id", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const patch: Record<string, unknown> = {};
        for (const k of [
          "status",
          "stage",
          "progress",
          "probe",
          "metrics",
          "preview_url",
          "result_url",
          "error",
          "detections",
        ]) {
          if (payload[k] !== undefined) patch[k] = payload[k];
        }
        if (!Object.keys(patch).length) return new Response("noop");

        const { error } = await supabaseAdmin
          .from("cleaner_jobs")
          .update(patch as never)
          .eq("id", id);
        if (error) return new Response(error.message, { status: 500 });
        return new Response("ok");
      },
    },
  },
});
