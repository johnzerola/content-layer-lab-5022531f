INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'posts',
  'posts',
  false,
  2147483648,
  ARRAY['video/mp4', 'video/webm', 'video/quicktime', 'application/octet-stream']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS token_ref text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_storage_at timestamptz;

UPDATE public.scheduled_posts
SET idempotency_key = id::text
WHERE idempotency_key IS NULL;

ALTER TABLE public.scheduled_posts
  ALTER COLUMN idempotency_key SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_posts_idempotency_key_idx
  ON public.scheduled_posts (idempotency_key);

CREATE INDEX IF NOT EXISTS scheduled_posts_processing_lock_idx
  ON public.scheduled_posts (status, locked_at);

CREATE TABLE IF NOT EXISTS public.publish_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_post_id uuid REFERENCES public.scheduled_posts(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  provider text,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.publish_logs TO authenticated;
GRANT ALL ON public.publish_logs TO service_role;

ALTER TABLE public.publish_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own publish logs read" ON public.publish_logs;
CREATE POLICY "own publish logs read" ON public.publish_logs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
