-- Migração para reforçar RLS e GRANTs nas tabelas principais para multi-tenancy e segurança SaaS.
-- Data: 2026-08-16

-- 1. SOCIAL_ACCOUNTS
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver suas próprias contas sociais" ON public.social_accounts;
CREATE POLICY "Usuários podem ver suas próprias contas sociais"
  ON public.social_accounts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuários podem gerenciar suas próprias contas sociais" ON public.social_accounts;
CREATE POLICY "Usuários podem gerenciar suas próprias contas sociais"
  ON public.social_accounts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_accounts TO authenticated;
GRANT ALL ON public.social_accounts TO service_role;

-- 2. SCHEDULED_POSTS
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver seus próprios agendamentos" ON public.scheduled_posts;
CREATE POLICY "Usuários podem ver seus próprios agendamentos"
  ON public.scheduled_posts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuários podem gerenciar seus próprios agendamentos" ON public.scheduled_posts;
CREATE POLICY "Usuários podem gerenciar seus próprios agendamentos"
  ON public.scheduled_posts FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_posts TO authenticated;
GRANT ALL ON public.scheduled_posts TO service_role;

-- 3. CLEANER_JOBS (Reforço)
ALTER TABLE public.cleaner_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuários podem ver seus próprios jobs de limpeza" ON public.cleaner_jobs;
CREATE POLICY "Usuários podem ver seus próprios jobs de limpeza"
  ON public.cleaner_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuários podem gerenciar seus próprios jobs de limpeza" ON public.cleaner_jobs;
CREATE POLICY "Usuários podem gerenciar seus próprios jobs de limpeza"
  ON public.cleaner_jobs FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cleaner_jobs TO authenticated;
GRANT ALL ON public.cleaner_jobs TO service_role;

-- 4. BUCKET 'posts' (Políticas de Storage)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'posts') THEN
    DROP POLICY IF EXISTS "Acesso individual ao bucket posts" ON storage.objects;
    CREATE POLICY "Acesso individual ao bucket posts"
      ON storage.objects FOR ALL
      TO authenticated
      USING (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text)
      WITH CHECK (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text);
  END IF;
END $$;
