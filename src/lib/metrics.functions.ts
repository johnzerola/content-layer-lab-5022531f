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
};

export const getMetrics = createServerFn({ method: "GET" })
  .handler(async () => {
    // Note: In a real app, we would call Meta/TikTok/YouTube APIs here to refresh metrics.
    // For this implementation, we read what's in the database, potentially seeded by a cron.
    
    const { data, error } = await supabase
      .from("post_insights")
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

    return (data || []).map(item => ({
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
    // This would be the place to trigger a background job to fetch latest data from APIs
    // For now, let's mock an update to show the UI works
    const { error } = await supabase
      .from("post_insights")
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
