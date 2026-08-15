/** Contas sociais conectadas e fila de publicações agendadas (Lovable Cloud). */
import { supabase } from "@/integrations/supabase/client";
import { currentUser } from "@/lib/cloud";

export type PostKind = "reels" | "feed" | "stories";

export const KIND_LABEL: Record<PostKind, string> = {
  reels: "Reels",
  feed: "Feed",
  stories: "Stories",
};

export type SocialAccount = {
  id: string;
  platform: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  provider: string;
  provider_account_id: string | null;
  status: string;
  created_at: string;
};

export type ScheduledPost = {
  id: string;
  account_id: string | null;
  kind: PostKind;
  caption: string;
  video_url: string | null;
  video_path: string | null;
  file_name: string | null;
  scheduled_at: string;
  status: string;
  attempts: number;
  error: string | null;
  published_at: string | null;
  permalink: string | null;
};

export const STATUS_LABEL: Record<string, string> = {
  agendado: "Agendado",
  processando: "Publicando",
  publicado: "Publicado",
  falhou: "Falhou",
  cancelado: "Cancelado",
};

/* ------------------------------- contas -------------------------------- */

export async function listAccounts(): Promise<SocialAccount[]> {
  const { data, error } = await supabase
    .from("social_accounts")
    .select("id,platform,username,display_name,avatar_url,provider,provider_account_id,status,created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SocialAccount[];
}

export async function removeAccount(id: string) {
  const { error } = await supabase.from("social_accounts").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------------------- vídeo no storage --------------------------- */

/** Sobe o MP4 para o bucket privado e devolve caminho + link assinado (7 dias). */
export async function uploadPostVideo(file: File | Blob, fileName: string) {
  const user = await currentUser();
  if (!user) throw new Error("Faça login para enviar o vídeo.");
  const safe = fileName.replace(/[^\w.-]+/g, "_");
  const path = `${user.id}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from("posts").upload(path, file, {
    contentType: (file as File).type || "video/mp4",
    upsert: false,
  });
  if (error) throw error;
  const { data } = await supabase.storage.from("posts").createSignedUrl(path, 60 * 60 * 24 * 7);
  return { path, url: data?.signedUrl ?? null };
}

/* ----------------------------- agendamentos ------------------------------ */

export type NewPost = {
  accountId: string | null;
  kind: PostKind;
  caption: string;
  scheduledAt: Date;
  videoPath?: string | null;
  videoUrl?: string | null;
  fileName?: string | null;
};

export async function schedulePost(p: NewPost) {
  const user = await currentUser();
  if (!user) throw new Error("Faça login para agendar.");
  const { error } = await supabase.from("scheduled_posts").insert({
    user_id: user.id,
    account_id: p.accountId,
    kind: p.kind,
    caption: p.caption,
    scheduled_at: p.scheduledAt.toISOString(),
    video_path: p.videoPath ?? null,
    video_url: p.videoUrl ?? null,
    file_name: p.fileName ?? null,
    status: "agendado",
  });
  if (error) throw error;
}

export async function listPosts(limit = 200): Promise<ScheduledPost[]> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select(
      "id,account_id,kind,caption,video_url,video_path,file_name,scheduled_at,status,attempts,error,published_at,permalink",
    )
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ScheduledPost[];
}

export async function cancelPost(id: string) {
  const { error } = await supabase.from("scheduled_posts").update({ status: "cancelado" }).eq("id", id);
  if (error) throw error;
}

export async function reschedulePost(id: string, when: Date) {
  const { error } = await supabase
    .from("scheduled_posts")
    .update({
      scheduled_at: when.toISOString(),
      status: "agendado",
      attempts: 0,
      error: null,
      error_code: null,
      next_attempt_at: null,
      lock_id: null,
      locked_at: null,
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deletePost(id: string) {
  const { error } = await supabase.from("scheduled_posts").delete().eq("id", id);
  if (error) throw error;
}
