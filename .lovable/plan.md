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
- Provides options for scheduling intervals (e.g., every X hours, or daily at a fixed time).
- Allows a base caption for all videos.

### 2. Update `src/routes/index.tsx` (Dashboard)
- Add a "Fazer agendamento automático" button that appears after batch processing is complete.
- Integrate the `AutoScheduleModal`.
- Logic: Takes all successfully processed items and schedules them using `schedulePost` and `uploadPostVideo` from `src/lib/social.ts`.

### 3. Update `src/lib/social.ts`
- Add a helper for bulk scheduling.

## Visual Text Edits
The requested phrase was interpreted as the instruction to build this feature.

