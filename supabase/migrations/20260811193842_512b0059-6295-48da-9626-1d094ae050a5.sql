CREATE TABLE public.cleaner_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  size_bytes BIGINT,
  mode TEXT NOT NULL DEFAULT 'subtitle',
  preset TEXT NOT NULL DEFAULT 'quality',
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  probe JSONB,
  detections JSONB NOT NULL DEFAULT '[]'::jsonb,
  masks JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  metrics JSONB,
  preview_url TEXT,
  result_url TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cleaner_jobs_user_created_idx ON public.cleaner_jobs (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cleaner_jobs TO authenticated;
GRANT ALL ON public.cleaner_jobs TO service_role;

ALTER TABLE public.cleaner_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own cleaner jobs" ON public.cleaner_jobs
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_cleaner_jobs_updated_at
BEFORE UPDATE ON public.cleaner_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();