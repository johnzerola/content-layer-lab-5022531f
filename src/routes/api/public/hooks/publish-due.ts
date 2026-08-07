// Publica os posts vencidos da fila. Chamado por agendador (pg_cron) ou manualmente.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/publish-due")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { publish, activeProvider } = await import("@/lib/publish.server");

        const nowIso = new Date().toISOString();
        const { data: due, error } = await supabaseAdmin
          .from("scheduled_posts")
          .select("id,user_id,account_id,kind,caption,video_url,video_path,attempts")
          .eq("status", "agendado")
          .lte("scheduled_at", nowIso)
          .order("scheduled_at", { ascending: true })
          .limit(10);

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 });
        }
        if (!due?.length) {
          return Response.json({ ok: true, processed: 0, provider: activeProvider() });
        }

        let published = 0;
        let failed = 0;

        for (const post of due) {
          await supabaseAdmin.from("scheduled_posts").update({ status: "processando" }).eq("id", post.id);

          let videoUrl = post.video_url;
          if (!videoUrl && post.video_path) {
            const { data: signed } = await supabaseAdmin.storage
              .from("posts")
              .createSignedUrl(post.video_path, 60 * 60 * 6);
            videoUrl = signed?.signedUrl ?? null;
          }

          let username = "";
          if (post.account_id) {
            const { data: acc } = await supabaseAdmin
              .from("social_accounts")
              .select("username")
              .eq("id", post.account_id)
              .maybeSingle();
            username = acc?.username ?? "";
          }

          const result = videoUrl
            ? await publish({
                kind: post.kind as "reels" | "feed" | "stories",
                caption: post.caption,
                videoUrl,
                username,
              })
            : ({ ok: false, error: "Vídeo indisponível para publicação." } as const);

          if (result.ok) {
            published++;
            await supabaseAdmin
              .from("scheduled_posts")
              .update({
                status: "publicado",
                published_at: new Date().toISOString(),
                permalink: result.permalink ?? null,
                error: null,
              })
              .eq("id", post.id);
          } else {
            failed++;
            await supabaseAdmin
              .from("scheduled_posts")
              .update({
                status: "falhou",
                attempts: (post.attempts ?? 0) + 1,
                error: result.error.slice(0, 500),
              })
              .eq("id", post.id);
          }
        }

        return Response.json({ ok: true, processed: due.length, published, failed, provider: activeProvider() });
      },
    },
  },
});
