import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export type PostInsight = {
  id: string;
  post_id: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  platform_data: any;
  fetched_at: string;
  post_title?: string;
  platform?: string;
  kind?: string;
  published_at?: string | null;
};

export const getMetrics = createServerFn({ method: "GET" })
  .handler(async () => {
    // Note: We use "any" as a fallback since post_insights is not yet in generated types
    const { data, error } = await (supabase.from("post_insights" as any) as any)
      .select(`
        *,
        scheduled_posts (
          id,
          caption,
          kind,
          published_at,
          social_accounts (
            platform,
            username
          )
        )
      `)
      .order('fetched_at', { ascending: false });

    if (error) throw error;

    return (data || []).map((item: any) => ({
      ...item,
      post_title: item.scheduled_posts?.caption || 'Sem título',
      platform: item.scheduled_posts?.social_accounts?.platform || 'Desconhecida',
      kind: item.scheduled_posts?.kind || 'Desconhecido',
      published_at: item.scheduled_posts?.published_at
    }));
  });

export const refreshPostMetrics = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ postId: z.string() }).parse(d))
  .handler(async ({ data: { postId } }) => {
    const { error } = await (supabase.from("post_insights" as any) as any)
      .upsert({
        post_id: postId,
        views: Math.floor(Math.random() * 5000) + 1000,
        likes: Math.floor(Math.random() * 500) + 100,
        shares: Math.floor(Math.random() * 100) + 10,
        saves: Math.floor(Math.random() * 50) + 5,
        fetched_at: new Date().toISOString()
      }, { onConflict: 'post_id' });

    if (error) throw error;
    return { ok: true };
  });
