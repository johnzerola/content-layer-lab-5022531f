CREATE TABLE public.clip_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id uuid references public.scheduled_posts(id) on delete cascade,
  tags text[] not null default '{}'::text[],
  predicted_score integer not null default 0,
  clip_seconds numeric not null default 0,
  source text not null default 'corte-ia',
  created_at timestamp with time zone not null default now()
);

CREATE INDEX clip_outcomes_user_idx ON public.clip_outcomes(user_id);
CREATE INDEX clip_outcomes_post_idx ON public.clip_outcomes(post_id);
CREATE UNIQUE INDEX clip_outcomes_post_unique ON public.clip_outcomes(post_id) WHERE post_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clip_outcomes TO authenticated;
GRANT ALL ON public.clip_outcomes TO service_role;

ALTER TABLE public.clip_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own clip outcomes" ON public.clip_outcomes
FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);