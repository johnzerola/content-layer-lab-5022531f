ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS lock_id UUID,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_post_id TEXT;

CREATE TABLE IF NOT EXISTS public.social_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  social_account_id UUID NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'pending',
  provider_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (social_account_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_connections TO authenticated;
GRANT ALL ON public.social_connections TO service_role;
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own social connections" ON public.social_connections;
CREATE POLICY "Users manage own social connections"
  ON public.social_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS scheduled_posts_due_idx
  ON public.scheduled_posts (status, scheduled_at);

CREATE OR REPLACE FUNCTION public.claim_due_scheduled_posts(
  p_lock_id UUID,
  p_limit INTEGER,
  p_lock_timeout_seconds INTEGER,
  p_max_attempts INTEGER
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  account_id UUID,
  kind TEXT,
  caption TEXT,
  video_url TEXT,
  video_path TEXT,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT sp.id
    FROM public.scheduled_posts sp
    WHERE sp.status IN ('agendado', 'processando')
      AND sp.attempts < p_max_attempts
      AND sp.scheduled_at <= now()
      AND (sp.next_attempt_at IS NULL OR sp.next_attempt_at <= now())
      AND (
        sp.lock_id IS NULL
        OR sp.locked_at IS NULL
        OR sp.locked_at < now() - make_interval(secs => p_lock_timeout_seconds)
      )
    ORDER BY sp.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scheduled_posts sp
  SET status = 'processando',
      lock_id = p_lock_id,
      locked_at = now(),
      attempts = sp.attempts + 1,
      updated_at = now()
  FROM due
  WHERE sp.id = due.id
  RETURNING sp.id, sp.user_id, sp.account_id, sp.kind, sp.caption, sp.video_url, sp.video_path, sp.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_scheduled_posts(UUID, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_posts(UUID, INTEGER, INTEGER, INTEGER) TO service_role;