/** Sincronização opcional da biblioteca com a nuvem (login por e-mail ou Google). */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { migrate, type Template } from "@/lib/template";

export type CloudUser = { id: string; email: string | null };

export async function currentUser(): Promise<CloudUser | null> {
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}

export function onAuth(cb: (u: CloudUser | null) => void) {
  const { data } = supabase.auth.onAuthStateChange((_e, session) => {
    cb(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null);
  });
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return Boolean(data.session);
}

export async function signOut() {
  await supabase.auth.signOut();
}

/** Envia todos os templates locais para a nuvem (um registro por template). */
export async function pushTemplates(list: Template[]) {
  const user = await currentUser();
  if (!user) throw new Error("Faça login para sincronizar.");
  const rows = list.map((t) => ({
    user_id: user.id,
    local_id: t.id,
    name: t.name,
    data: t as unknown as Json,
  }));
  const { data, error } = await supabase
    .from("templates")
    .upsert(rows, { onConflict: "user_id,local_id" })
    .select("id,local_id,data");
  if (error) throw error;

  // guarda também uma versão no histórico da nuvem
  const versions = (data ?? []).map((r) => ({
    user_id: user.id,
    template_id: r.id,
    label: new Date().toLocaleString("pt-BR"),
    data: r.data,
  }));
  if (versions.length) await supabase.from("template_versions").insert(versions);
  return rows.length;
}

/** Traz os templates da nuvem e mescla com os locais (a nuvem vence por id). */
export async function pullTemplates(local: Template[]): Promise<Template[]> {
  const user = await currentUser();
  if (!user) throw new Error("Faça login para sincronizar.");
  const { data, error } = await supabase
    .from("templates")
    .select("local_id,data")
    .order("updated_at", { ascending: false });
  if (error) throw error;

  const remote = (data ?? [])
    .map((r) => r.data as unknown as Template)
    .filter((t) => t && t.video)
    .map(migrate);

  const byId = new Map(local.map((t) => [t.id, t]));
  for (const t of remote) byId.set(t.id, t);
  return [...byId.values()];
}

export type BatchLog = {
  mode: string;
  templateName?: string;
  platforms: string[];
  videos: number;
  ok: number;
  failed: number;
  seconds: number;
};

/** Registra o lote no histórico da conta (silencioso quando não há login). */
export async function logBatch(b: BatchLog) {
  const user = await currentUser();
  if (!user) return;
  await supabase.from("batches").insert({
    user_id: user.id,
    mode: b.mode,
    template_name: b.templateName ?? null,
    platforms: b.platforms,
    videos: b.videos,
    ok: b.ok,
    failed: b.failed,
    seconds: b.seconds,
  });
}

export type BatchRow = {
  id: string;
  mode: string;
  template_name: string | null;
  platforms: string[];
  videos: number;
  ok: number;
  failed: number;
  seconds: number;
  created_at: string;
};

export async function listBatches(): Promise<BatchRow[]> {
  const { data, error } = await supabase
    .from("batches")
    .select("id,mode,template_name,platforms,videos,ok,failed,seconds,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as BatchRow[];
}
