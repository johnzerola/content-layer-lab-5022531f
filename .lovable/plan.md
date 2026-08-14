# Plan - Automatic Scheduling after Batch Processing

Implement a feature to allow users to automatically schedule all processed videos in a batch to their connected social accounts.

## User Review Required

> [!IMPORTANT]
> This feature requires the user to have at least one social account connected (Instagram) in the **Agenda** section and to be logged in to their cloud account.

## Proposed Changes

### 1. New Modal Component: `AutoScheduleModal`
Create a new component `src/components/AutoScheduleModal.tsx` that:
- Lists connected social accounts.
- Allows selecting the post format (Reels, Feed, Stories).
- Provides options for scheduling intervals (e.g., one video every 2 hours, or every day at a specific time).
- Allows a base caption/hashtags for all videos.

### 2. Update `src/routes/index.tsx` (Dashboard)
- Add a "Fazer agendamento automático" button that appears after batch processing is complete (next to the report or the ZIP download button).
- Integrate the `AutoScheduleModal`.
- Implement the logic to take all successfully processed items and schedule them using the `schedulePost` and `uploadPostVideo` functions from `src/lib/social.ts`.

### 3. Update `src/lib/social.ts`
- Add a helper function to bulk schedule multiple videos to simplify the implementation in the UI.

## Technical Details

- **Concurrency**: Uploading many videos to Supabase Storage and then inserting into the database will be done sequentially or with limited concurrency to avoid overwhelming the client's connection.
- **State Management**: The modal will manage its own internal state for the scheduling logic (start date, interval).
- **Backend**: Uses existing Supabase tables (`social_accounts`, `scheduled_posts`) and Storage bucket (`posts`).

## Visual Text Edits (as requested)
The requested command phrase will be understood as an instruction for this implementation.
