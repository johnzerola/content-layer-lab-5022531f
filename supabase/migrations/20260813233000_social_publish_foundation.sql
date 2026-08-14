-- Reliable social publishing queue and server-only connection metadata.
-- Existing scheduled posts and account records remain valid.
-- This is intentionally a one-time migration: accidental reapplication fails
-- on existing columns/objects instead of silently hiding deployment drift.

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.scheduled_posts') IS NULL THEN
    RAISE EXCEPTION 'required table public.scheduled_posts does not exist';
  END IF;
  IF pg_catalog.to_regprocedure('public.touch_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'required function public.touch_updated_at() does not exist';
  END IF;
END;
$$;

ALTER TABLE public.scheduled_posts
  ADD COLUMN locked_at timestamptz,
  ADD COLUMN lock_id uuid,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN error_code text,
  ADD COLUMN provider_post_id text;

-- Preserve legacy rows while enforcing the queue invariant expected by the RPC.
UPDATE public.scheduled_posts
SET attempts = 0
WHERE attempts IS NULL;

ALTER TABLE public.scheduled_posts
  ALTER COLUMN attempts SET DEFAULT 0,
  ALTER COLUMN attempts SET NOT NULL;

CREATE INDEX scheduled_posts_claim_idx
  ON public.scheduled_posts (status, next_attempt_at, scheduled_at)
  WHERE status IN ('agendado', 'processando');

CREATE TABLE public.social_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL UNIQUE REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_account_id text,
  status text NOT NULL DEFAULT 'aguardando_configuracao',
  secret_ref text,
  refresh_secret_ref text,
  expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_connections_status_valid CHECK (
    status IN ('aguardando_configuracao', 'conectando', 'conectado', 'atencao', 'expirado', 'erro')
  )
);

COMMENT ON COLUMN public.social_connections.secret_ref IS
  'Opaque reference to a credential in an external secret store; never store a raw token here.';
COMMENT ON COLUMN public.social_connections.refresh_secret_ref IS
  'Opaque reference to a refresh credential in an external secret store; never store a raw token here.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_connections TO service_role;
REVOKE ALL ON public.social_connections FROM PUBLIC, anon, authenticated;
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER social_connections_touch
  BEFORE UPDATE ON public.social_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX social_connections_user_idx
  ON public.social_connections (user_id, provider);

-- Short-lived, server-only OAuth state. Only a digest is stored so a database
-- read cannot be used to forge a callback.
CREATE TABLE public.social_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  provider text NOT NULL,
  state_digest text NOT NULL UNIQUE,
  code_verifier_secret_ref text,
  redirect_path text NOT NULL DEFAULT '/integracoes',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_oauth_states TO service_role;
REVOKE ALL ON public.social_oauth_states FROM PUBLIC, anon, authenticated;
ALTER TABLE public.social_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE INDEX social_oauth_states_expiry_idx ON public.social_oauth_states (expires_at);

-- Claims due work in one transaction. SKIP LOCKED lets concurrent workers claim
-- different rows without publishing the same row twice.
CREATE OR REPLACE FUNCTION public.claim_due_scheduled_posts(
  p_lock_id uuid,
  p_limit integer DEFAULT 10,
  p_lock_timeout_seconds integer DEFAULT 900,
  p_max_attempts integer DEFAULT 5
)
RETURNS SETOF public.scheduled_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_lock_id IS NULL THEN
    RAISE EXCEPTION 'lock id is required';
  END IF;

  -- Close exhausted queued rows and abandoned workers. A worker with a recent
  -- lock remains untouched even when its current attempt reaches the limit.
  UPDATE public.scheduled_posts
  SET status = 'falhou',
      error_code = 'RETRY_EXHAUSTED',
      error = COALESCE(error, 'Limite de tentativas atingido.'),
      lock_id = NULL,
      locked_at = NULL,
      next_attempt_at = NULL
  WHERE attempts >= GREATEST(p_max_attempts, 1)
    AND (
      status = 'agendado'
      OR (
        status = 'processando'
        AND (
          locked_at IS NULL
          OR locked_at < pg_catalog.now() - pg_catalog.make_interval(secs => GREATEST(p_lock_timeout_seconds, 60))
        )
      )
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT sp.id
    FROM public.scheduled_posts sp
    WHERE sp.attempts < GREATEST(p_max_attempts, 1)
      AND (
        (
          sp.status = 'agendado'
          AND sp.scheduled_at <= pg_catalog.now()
          AND (sp.next_attempt_at IS NULL OR sp.next_attempt_at <= pg_catalog.now())
        )
        OR (
          sp.status = 'processando'
          AND (
            sp.locked_at IS NULL
            OR sp.locked_at < pg_catalog.now() - pg_catalog.make_interval(secs => GREATEST(p_lock_timeout_seconds, 60))
          )
        )
      )
    ORDER BY COALESCE(sp.next_attempt_at, sp.scheduled_at), sp.scheduled_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  UPDATE public.scheduled_posts sp
  SET status = 'processando',
      lock_id = p_lock_id,
      locked_at = pg_catalog.now(),
      last_attempt_at = pg_catalog.now(),
      attempts = sp.attempts + 1,
      next_attempt_at = NULL,
      error = NULL,
      error_code = NULL
  FROM candidates
  WHERE sp.id = candidates.id
  RETURNING sp.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_scheduled_posts(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_posts(uuid, integer, integer, integer) TO service_role;
