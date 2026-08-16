# Plan: SaaS Professionalization & Scalability Architecture

This plan establishes a professional foundation for the SaaS, ensuring the code is maintainable for future developers, scalable for many concurrent users, and robust against common bugs.

## Technical Improvements

### 1. Robust Type Safety & Error Handling
- **Global Error Boundaries**: Implement a unified error tracking system in `src/lib/lovable-error-reporting.ts` to capture and log client-side crashes to the backend for developer review.
- **Strict Zod Validation**: Ensure every `createServerFn` has a `zod` input validator to prevent malformed data from reaching the database.

### 2. Multi-tenant Data Protection (Supabase & RLS)
- **RLS Audit**: Verify and reinforce Row Level Security on all public tables (`templates`, `projects`, `batches`, `exports`, `post_insights`).
- **Policy Enforcement**: Ensure that every `CREATE TABLE` migration includes explicit `GRANT` and `POLICY` statements tied to `auth.uid()`.

### 3. Scalable Asset Management
- **Cloud Storage Fallback**: Enhance the `localStorage` fallback logic to automatically migrate user settings and drafts to Supabase when browser storage is constrained.
- **Job Queue Efficiency**: Refine the `src/lib/jobs.ts` engine to handle multiple concurrent uploads and render tasks without blocking the main UI thread.

### 4. Developer Handoff & Documentation
- **API Reference**: Update `.lovable/docs/architecture/` with a new `api-reference.md` mapping all `createServerFn` endpoints.
- **Component Documentation**: Add JSDoc comments to core components (`VideoStudio`, `ClipStudio`, `CleanerIAStudio`) explaining their state lifecycle and handoff points.

## User-Facing Changes
- **Status Dashboard**: A dedicated area in "Integrações" or "Nuvem" to view system health, worker status, and current storage usage.
- **Session Recovery**: Automated "Resume Project" prompts when a user returns to a tool they didn't finish using.

## Technical Details
- **Backend**: TanStack Start v1 (React 19) + Supabase.
- **Workers**: External Python/GPU workers for AI tasks (HMAC signed).
- **Storage**: IndexedDB for local drafts, Supabase for cloud persistence.
