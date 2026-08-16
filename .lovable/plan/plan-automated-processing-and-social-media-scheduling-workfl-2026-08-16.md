# Plan: Automated Processing and Social Media Scheduling Workflow

Implement a synchronized workflow where videos, after being edited or having templates applied, are automatically processed and queued for social media publication based on user preferences.

## User Requirements
- Synchronized system after video editing.
- Automatic application of templates (when selected).
- Automatic processing (rendering) for social media posting.
- Integration with the scheduling system.

## Proposed Changes

### 1. Unified Processing Queue System
- Refactor the existing `Job` system in `src/lib/jobs.ts` to support post-render actions.
- Add a `nextAction` field to the `Job` metadata to store scheduling preferences (account, kind, interval, etc.).

### 2. Auto-Process Toggle in Editor
- Add an "Agendar automaticamente após exportar" (Auto-schedule after export) toggle in `src/components/VideoStudio.tsx` and `src/components/TemplateEditor.tsx`.
- Capture social media preferences (account, platform) within the export/save dialogs.

### 3. Automated Hand-off to Publishing
- In `src/lib/render.ts` (specifically `encodeMp4`), once the blob is ready, check if an auto-schedule action is pending.
- If pending, automatically call `uploadPostVideo` and `schedulePost` from `src/lib/social.ts` using the metadata stored in the job.

### 4. Batch Automation in Home Dashboard
- Update the "Processar Lote" (Process Batch) logic in `src/routes/index.tsx` to include an option for automatic scheduling of all successful results.
- Implement a sequential "Render -> Upload -> Schedule" pipeline for each item in the batch.

## Technical Details
- **Persistence**: Use `localStorage` or `IndexedDB` to keep the auto-schedule configuration between tool switches (handoff).
- **Security**: Ensure `requireSupabaseAuth` is respected for all scheduling calls.
- **Error Handling**: If a render succeeds but the upload/schedule fails, mark the job as "Pronto" but with a warning about the failed schedule, allowing manual retry.
- **Environment**: Use the existing `PUBLISH_CRON_SECRET` and Meta/YouTube/TikTok integrations.

## User Verification
- User completes an edit in VideoStudio and clicks "Salvar e Agendar".
- System shows a progress bar: Render (0-100%) -> Uploading -> Scheduled.
- User visits the "Agenda" page and sees the new post listed with the correct timestamp.
