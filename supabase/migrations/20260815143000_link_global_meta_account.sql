-- Atomically binds a validated Instagram account to the global server-side Meta credential.
-- The access token remains in the server environment and is never stored in this database.

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.social_accounts') IS NULL THEN
    RAISE EXCEPTION 'required table public.social_accounts does not exist';
  END IF;
  IF pg_catalog.to_regclass('public.social_connections') IS NULL THEN
    RAISE EXCEPTION 'required table public.social_connections does not exist';
  END IF;
END;
$$;

-- A later compatibility migration granted authenticated direct access. Keep
-- authorization metadata server-only; the service role remains the sole app caller.
REVOKE ALL ON public.social_connections FROM PUBLIC, anon, authenticated;
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.link_global_meta_account(
  p_user_id uuid,
  p_username text,
  p_provider_account_id text
)
RETURNS TABLE (
  id uuid,
  platform text,
  username text,
  display_name text,
  avatar_url text,
  provider text,
  provider_account_id text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account public.social_accounts%ROWTYPE;
  v_connection public.social_connections%ROWTYPE;
  v_connection_id uuid;
BEGIN
  IF p_user_id IS NULL OR p_username IS NULL OR p_provider_account_id IS NULL THEN
    RAISE EXCEPTION 'validated account data is required';
  END IF;
  IF p_username !~ '^[a-z0-9._]{1,30}$' OR btrim(p_provider_account_id) = '' THEN
    RAISE EXCEPTION 'validated account data is invalid';
  END IF;

  INSERT INTO public.social_accounts (user_id, platform, username, provider, status)
  VALUES (p_user_id, 'instagram', p_username, 'pending', 'aguardando provedor')
  ON CONFLICT (user_id, platform, username) DO NOTHING;

  SELECT sa.*
  INTO v_account
  FROM public.social_accounts AS sa
  WHERE sa.user_id = p_user_id
    AND sa.platform = 'instagram'
    AND sa.username = p_username
  FOR UPDATE;

  IF v_account.id IS NULL OR v_account.user_id <> p_user_id THEN
    RAISE EXCEPTION 'account ownership mismatch';
  END IF;
  IF v_account.provider NOT IN ('pending', 'meta') THEN
    RAISE EXCEPTION 'provider conflict';
  END IF;
  IF v_account.provider = 'meta'
     AND v_account.provider_account_id IS NOT NULL
     AND v_account.provider_account_id <> p_provider_account_id THEN
    RAISE EXCEPTION 'provider conflict';
  END IF;

  SELECT sc.*
  INTO v_connection
  FROM public.social_connections AS sc
  WHERE sc.social_account_id = v_account.id
  FOR UPDATE;

  IF v_connection.id IS NOT NULL THEN
    IF v_connection.user_id <> p_user_id THEN
      RAISE EXCEPTION 'account ownership mismatch';
    END IF;
    IF v_connection.provider NOT IN ('pending', 'meta') THEN
      RAISE EXCEPTION 'provider conflict';
    END IF;
    IF v_connection.provider = 'meta'
       AND v_connection.provider_account_id IS NOT NULL
       AND v_connection.provider_account_id <> p_provider_account_id THEN
      RAISE EXCEPTION 'provider conflict';
    END IF;
  END IF;

  INSERT INTO public.social_connections AS target (
    user_id,
    social_account_id,
    provider,
    provider_account_id,
    status
  )
  VALUES (
    p_user_id,
    v_account.id,
    'meta',
    p_provider_account_id,
    'conectado'
  )
  ON CONFLICT (social_account_id) DO UPDATE
  SET provider = EXCLUDED.provider,
      provider_account_id = EXCLUDED.provider_account_id,
      status = EXCLUDED.status,
      updated_at = pg_catalog.now()
  WHERE target.user_id = EXCLUDED.user_id
    AND target.provider IN ('pending', 'meta')
    AND (
      target.provider_account_id IS NULL
      OR target.provider_account_id = EXCLUDED.provider_account_id
    )
  RETURNING target.id INTO v_connection_id;

  IF v_connection_id IS NULL THEN
    RAISE EXCEPTION 'provider conflict';
  END IF;

  UPDATE public.social_accounts AS sa
  SET provider = 'meta',
      provider_account_id = p_provider_account_id,
      status = 'conectado',
      updated_at = pg_catalog.now()
  WHERE sa.id = v_account.id
    AND sa.user_id = p_user_id;

  RETURN QUERY
  SELECT sa.id,
         sa.platform,
         sa.username,
         sa.display_name,
         sa.avatar_url,
         sa.provider,
         sa.provider_account_id,
         sa.status,
         sa.created_at
  FROM public.social_accounts AS sa
  WHERE sa.id = v_account.id
    AND sa.user_id = p_user_id;
END;
$$;

COMMENT ON FUNCTION public.link_global_meta_account(uuid, text, text) IS
  'Persists an Instagram identity already validated server-side with the global Meta environment credential.';

REVOKE ALL ON FUNCTION public.link_global_meta_account(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_global_meta_account(uuid, text, text) TO service_role;
