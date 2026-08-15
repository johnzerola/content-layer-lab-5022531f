import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { requireCronAuthorization } from "@/lib/publish-auth.server";
import { runPublishQueue, type QueueDependencies } from "@/lib/publish-queue.server";

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LOCK_TIMEOUT_SECONDS = 15 * 60;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const Route = createFileRoute("/api/public/hooks/publish-due")({
  server: {
    handlers: {
      GET: async () =>
        new Response(null, {
          status: 405,
          headers: { Allow: "POST" },
        }),
      POST: async ({ request }) => {
        const unauthorized = requireCronAuthorization(request);
        if (unauthorized) return unauthorized;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { publish } = await import("@/lib/publish.server");
        const maxAttempts = positiveInteger(process.env["PUBLISH_MAX_ATTEMPTS"], DEFAULT_MAX_ATTEMPTS);
        const lockTimeoutSeconds = positiveInteger(
          process.env["PUBLISH_LOCK_TIMEOUT_SECONDS"],
          DEFAULT_LOCK_TIMEOUT_SECONDS,
        );

        const dependencies: QueueDependencies = {
          claim: async (lockId, limit, lockTimeout, maximumAttempts) => {
            const { data, error } = await supabaseAdmin.rpc("claim_due_scheduled_posts", {
              p_lock_id: lockId,
              p_limit: limit,
              p_lock_timeout_seconds: lockTimeout,
              p_max_attempts: maximumAttempts,
            });
            if (error) throw new Error("claim failed");
            return data ?? [];
          },
          loadAccount: async (accountId) => {
            const { data, error } = await supabaseAdmin
              .from("social_accounts")
              .select("id,user_id,platform,username,provider,provider_account_id")
              .eq("id", accountId)
              .maybeSingle();
            if (error) throw new Error("account lookup failed");
            return data;
          },
          loadConnection: async (accountId, userId) => {
            const { data, error } = await supabaseAdmin
              .from("social_connections")
              .select("provider,provider_account_id,status,expires_at")
              .eq("social_account_id", accountId)
              .eq("user_id", userId)
              .maybeSingle();
            if (error) throw new Error("connection lookup failed");
            return data;
          },
          createSignedUrl: async (videoPath, expiresInSeconds) => {
            const { data, error } = await supabaseAdmin.storage
              .from("posts")
              .createSignedUrl(videoPath, expiresInSeconds);
            if (error || !data?.signedUrl) throw new Error("signed URL failed");
            return data.signedUrl;
          },
          removeStorageObject: async (videoPath) => {
            const { error } = await supabaseAdmin.storage.from("posts").remove([videoPath]);
            if (error) throw new Error("storage cleanup failed");
          },
          publish,
          updateClaimedPost: async (postId, lockId, update) => {
            const { data, error } = await supabaseAdmin
              .from("scheduled_posts")
              .update(update)
              .eq("id", postId)
              .eq("lock_id", lockId)
              .select("id")
              .maybeSingle();
            if (error || !data) throw new Error("result update failed");
          },
          now: () => new Date(),
          log: (entry) => console.info(JSON.stringify(entry)),
        };

        try {
          const summary = await runPublishQueue(dependencies, {
            lockId: randomUUID(),
            limit: 10,
            lockTimeoutSeconds,
            maxAttempts,
          });
          return Response.json({ ok: true, ...summary });
        } catch {
          console.error(JSON.stringify({ event: "publish_dispatch_failed", code: "DATABASE_ERROR" }));
          return Response.json({ ok: false, error: "Falha ao processar a fila." }, { status: 500 });
        }
      },
    },
  },
});
