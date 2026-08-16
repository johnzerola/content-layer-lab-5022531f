# Plan - Finalize End-to-End Scheduling System

The system is ready for production social media scheduling. This plan verifies and finalizes the connection between the UI, the server-side logic, and the external APIs to ensure a seamless "point-to-point" experience.

## User Review Required

> [!IMPORTANT]
> To enable real Instagram posting, you must add these secrets in **Settings > Secrets**:
> 1. `META_ACCESS_TOKEN`: Your Meta Graph API Permanent Token.
> 2. `META_IG_USER_ID`: The unique ID of your Instagram Business account.
> 3. `PUBLISH_CRON_SECRET`: A long random string (min 32 chars) to secure the automation trigger.

## Proposed Changes

### Integration & API
- **Social Account Binding**: Ensure `link_global_meta_account` correctly binds accounts even when credentials change.
- **Queue Automation**: Prepare the `/api/public/hooks/publish-due` endpoint for external cron triggers (e.g., from an external scheduler or Supabase `pg_cron`).
- **Security Audit**: Verify that `requireCronAuthorization` is strictly enforced.

### UI & UX Improvements
- **Status Visibility**: Enhance the "Agenda" screen to show detailed error messages if a publication fails (e.g., "Invalid Token" vs "Media Error").
- **Retry Mechanism**: Add a "Tentar novamente" button for failed posts to manually re-queue them.
- **Connection Health**: Display a clear indicator in the Account list if the server-side credentials are missing or invalid.

### Backend & Database
- **RLS Lockdown**: Confirm `social_connections` is strictly `service_role` only to prevent token leaks.
- **Storage Policy**: Ensure the `posts` bucket has the necessary RLS for server-side signed URL generation.

## Technical Details
- **Architecture**: Distributed worker model using `SKIP LOCKED` for atomic job claiming.
- **Error Handling**: Mapping Meta Graph API errors (400, 401, 429) to user-friendly Portuguese messages.
- **Idempotency**: Using `scheduled_posts.id` as the idempotency key for Ayrshare/Meta to prevent double-posting on retries.
