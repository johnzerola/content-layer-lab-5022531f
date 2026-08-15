import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260813233000_social_publish_foundation.sql",
);

let migration = "";
let normalizedMigration = "";
let exhaustedUpdate = "";

beforeAll(async () => {
  migration = await readFile(migrationPath, "utf8");
  normalizedMigration = migration.replace(/\r\n/g, "\n");
  exhaustedUpdate = migration.slice(
    migration.indexOf("-- Close exhausted queued rows"),
    migration.indexOf("RETURN QUERY"),
  );
});
function exhaustedWorkerShouldClose(input: {
  status: string;
  attempts: number;
  maxAttempts: number;
  lockedAt: Date | null;
  now: Date;
  lockTimeoutSeconds: number;
}): boolean {
  if (input.attempts < input.maxAttempts) return false;
  if (input.status === "agendado") return true;
  if (input.status !== "processando") return false;
  if (!input.lockedAt) return true;
  return input.lockedAt.getTime() < input.now.getTime() - Math.max(input.lockTimeoutSeconds, 60) * 1000;
}

describe("social publishing production migration", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");

  it("does not exhaust a processing post whose lock is still valid", () => {
    expect(
      exhaustedWorkerShouldClose({
        status: "processando",
        attempts: 5,
        maxAttempts: 5,
        lockedAt: new Date("2026-08-14T11:59:30.000Z"),
        now,
        lockTimeoutSeconds: 900,
      }),
    ).toBe(false);

    expect(exhaustedUpdate).toContain("status = 'processando'");
    expect(exhaustedUpdate).toContain("locked_at < pg_catalog.now() - pg_catalog.make_interval");
  });

  it("exhausts a processing post only after its lock expires", () => {
    expect(
      exhaustedWorkerShouldClose({
        status: "processando",
        attempts: 5,
        maxAttempts: 5,
        lockedAt: new Date("2026-08-14T11:40:00.000Z"),
        now,
        lockTimeoutSeconds: 900,
      }),
    ).toBe(true);

    expect(exhaustedUpdate).toContain("error_code = 'RETRY_EXHAUSTED'");
    expect(exhaustedUpdate).toContain("locked_at IS NULL");
  });

  it("hardens prerequisites, attempts, privileges and SECURITY DEFINER resolution", () => {
    expect(migration).toContain("pg_catalog.to_regprocedure('public.touch_updated_at()')");
    expect(migration).toContain("ALTER COLUMN attempts SET DEFAULT 0");
    expect(migration).toContain("ALTER COLUMN attempts SET NOT NULL");
    expect(normalizedMigration).toContain("SECURITY DEFINER\nSET search_path = ''");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.claim_due_scheduled_posts(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).not.toContain("GRANT ALL ON public.social_connections");
    expect(migration).not.toContain("GRANT ALL ON public.social_oauth_states");
  });
});
