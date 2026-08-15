// Publica posts vencidos da fila. Chame somente por agendador confiavel.
import { createFileRoute } from "@tanstack/react-router";

type SocialAccountForPublish = {
  id: string;
  platform: "instagram" | "tiktok" | "youtube";
  username: string;
  provider: string;
  provider_account_id: string | null;
  status: string;
};

export const Route = createFileRoute("/api/public/hooks/publish-due")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { authorizedHook } = await import("@/lib/cleaner.server");
        let allowed = false;
        try {
          allowed = authorizedHook(request);
        } catch {
          return Response.json({ ok: false, error: "PUBLISH_HOOK_SECRET nao configurado" }, { status: 503 });
        }
        if (!allowed) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { publish, activeProvider } = await import("@/lib/publish.server");

        const nowIso = new Date().toISOString();
        const { data: due, error } = await supabaseAdmin
          .from("scheduled_posts")
          .select("id,user_id,account_id,kind,caption,video_url,video_path,attempts,idempotency_key")
          .eq("status", "agendado")
          .lte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(10);

        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        if (!due?.length) return Response.json({ ok: true, processed: 0, provider: activeProvider() });

        let claimedCount = 0;
        let published = 0;
        let failed = 0;

        for (const post of due) {
          const idempotencyKey = post.idempotency_key ?? post.id;
          const { data: claimed } = await supabaseAdmin
            .from("scheduled_posts")
            .update({
              status: "processando",
              locked_at: new Date().toISOString(),
              idempotency_key: idempotencyKey,
            })
            .eq("id", post.id)
            .eq("status", "agendado")
            .select("id")
            .maybeSingle();

          if (!claimed) continue;
          claimedCount++;

          let videoUrl = post.video_url;
          if (!videoUrl && post.video_path) {
            const { data: signed } = await supabaseAdmin.storage
              .from("posts")
              .createSignedUrl(post.video_path, 60 * 60 * 6);
            videoUrl = signed?.signedUrl ?? null;
          }

          let account: SocialAccountForPublish | null = null;
          if (post.account_id) {
            const { data: acc } = await supabaseAdmin
              .from("social_accounts")
              .select("id,platform,username,provider,provider_account_id,status")
              .eq("id", post.account_id)
              .eq("user_id", post.user_id)
              .maybeSingle();
            account = acc as SocialAccountForPublish | null;
          }

          const connected = account?.status === "connected" || account?.status === "conectado";
          const result =
            videoUrl && account && connected && account.provider_account_id
              ? await publish({
                  accountId: account.id,
                  platform: account.platform,
                  kind: post.kind as "reels" | "feed" | "stories",
                  caption: post.caption,
                  videoUrl,
                  username: account.username,
                  provider: account.provider,
                  providerAccountId: account.provider_account_id,
                  idempotencyKey,
                })
              : ({
                  ok: false,
                  error: !videoUrl ? "Video indisponivel para publicacao." : "Conta social sem OAuth/API valido.",
                } as const);

          await supabaseAdmin.from("publish_logs").insert({
            scheduled_post_id: post.id,
            user_id: post.user_id,
            account_id: post.account_id,
            provider: activeProvider(),
            status: result.ok ? "published" : "failed",
            idempotency_key: idempotencyKey,
            error: result.ok ? null : result.error.slice(0, 500),
          });

          if (result.ok) {
            published++;
            await supabaseAdmin
              .from("scheduled_posts")
              .update({
                status: "publicado",
                published_at: new Date().toISOString(),
                permalink: result.permalink ?? null,
                error: null,
                locked_at: null,
                deleted_storage_at: post.video_path ? new Date().toISOString() : null,
              })
              .eq("id", post.id);

            if (post.video_path) await supabaseAdmin.storage.from("posts").remove([post.video_path]).catch(() => null);
          } else {
            failed++;
            await supabaseAdmin
              .from("scheduled_posts")
              .update({
                status: "falhou",
                attempts: (post.attempts ?? 0) + 1,
                error: result.error.slice(0, 500),
                locked_at: null,
              })
              .eq("id", post.id);
          }
        }

        return Response.json({
          ok: true,
          processed: due.length,
          claimed: claimedCount,
          published,
          failed,
          provider: activeProvider(),
        });
      },
    },
  },
});
