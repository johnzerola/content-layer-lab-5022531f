import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20260822221000_social_connection_credentials.sql",
  "utf8",
).toLowerCase();

describe("multi-tenant social credential migration", () => {
  it("keeps credentials server-only, encrypted and transactionally linked", () => {
    expect(sql).toContain("access_token_ciphertext text not null");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("revoke all on public.social_connection_credentials from public, anon, authenticated");
    expect(sql).toContain("to service_role");
    expect(sql).not.toMatch(/grant\s+.*social_connection_credentials.*authenticated/);
    expect(sql).not.toMatch(/\b(drop|truncate)\s+(table\s+)?public\./);
  });
});
