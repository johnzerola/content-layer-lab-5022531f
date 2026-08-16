# Plan - YouTube and TikTok (Browser-based) Publishing Integration

This plan implements automatic publishing for YouTube Shorts and a browser-based "manual" or "no-API" approach for TikTok, integrating them into the existing scheduling and agenda infrastructure.

## User Review Required

> [!IMPORTANT]
> - **YouTube Integration**: We will use a standard OAuth-based approach for YouTube Shorts (via Google API).
> - **TikTok "No-API"**: Since the user requested a "no-API" way for TikTok, we will implement a "Send to Mobile" or "Browser Automation Assist" flow where the system prepares the video and metadata, and provides a direct link or a guided browser session (if supported by environment) to finish the post manually, avoiding strict API review hurdles.
> - **Platform Scope**: We are adding YouTube and TikTok to the existing "VaiViral" agenda and batch scheduling tools.

## Proposed Changes

### 1. Database & Types (`public` schema)
- Update `SocialPlatform` and `SocialProvider` enums/types to include `youtube` and `tiktok`.
- Update `PLATFORM_CAPABILITIES` in `src/lib/publishing.ts` to reflect support for Shorts and TikTok.

### 2. YouTube Integration (Server-side)
- Implement `publishYoutube` in `src/lib/publish.server.ts` using the Google APIs Client Library.
- Handle YouTube Shorts specific requirements (vertical video, hashtag #shorts in description).

### 3. TikTok Assist Integration (Client & Server)
- Implement a `publishTikTokAssist` flow. 
- Instead of a direct API post, this will transition the post to a "Ready to Post" status and generate a specialized landing page/modal that allows the user to download the optimized video and copy the caption with one click, or redirects them to the TikTok web upload page with parameters.

### 4. UI Enhancements
- **Agenda Page**: Update `src/routes/agenda.tsx` to support connecting YouTube and TikTok accounts.
- **AutoSchedule Modal**: Update `src/components/AutoScheduleModal.tsx` to allow selecting these new platforms for batch jobs.
- **Platform Icons**: Add YouTube and TikTok icons (from `lucide-react`) to the UI.

### 5. Backend Worker Update
- Update `src/lib/publish-queue.server.ts` to handle the new providers.

## Technical Details
- **YouTube OAuth**: Will utilize the existing connector pattern or a dedicated Google OAuth flow.
- **TikTok Manual**: Focus on UX that makes manual posting as fast as possible (one-click copy, direct upload link).
- **Security**: Ensure all OAuth tokens are handled via Supabase `social_connections` with RLS.

## Sequence of Work
1. Update shared types and platform configuration.
2. Implement YouTube publishing logic in the server backend.
3. Implement the TikTok assistance flow.
4. Update the Agenda and AutoSchedule UI components to show the new options.
5. Verify the publishing queue picks up the new platform types.
