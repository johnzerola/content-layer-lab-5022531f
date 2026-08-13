ALTER TABLE public.cleaner_jobs
  ADD COLUMN callback_seq BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT cleaner_jobs_size_positive CHECK (size_bytes IS NULL OR size_bytes > 0),
  ADD CONSTRAINT cleaner_jobs_progress_range CHECK (progress >= 0 AND progress <= 100),
  ADD CONSTRAINT cleaner_jobs_status_valid CHECK (
    status IN (
      'queued', 'uploaded', 'analyzing', 'detecting', 'tracking', 'processing',
      'inpainting', 'refining', 'encoding', 'completed', 'failed'
    )
  ),
  ADD CONSTRAINT cleaner_jobs_mode_valid CHECK (
    mode IN ('smart', 'subtitle', 'text', 'watermark', 'logo', 'object', 'passerby')
  ),
  ADD CONSTRAINT cleaner_jobs_preset_valid CHECK (preset IN ('fast', 'quality', 'max'));

CREATE INDEX cleaner_jobs_status_updated_idx
  ON public.cleaner_jobs (status, updated_at DESC);
