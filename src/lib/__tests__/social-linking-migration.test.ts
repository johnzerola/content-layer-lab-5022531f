import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

let migration = "";
let normalizedMigration = "";

beforeAll(async () => {
  migration = await readFile(
    resolve(process.cwd(), "supabase/migrations/20260815143000_link_global_meta_account.sql"),
    "utf8",
  );
  normalizedMigration = migration.replace(/\r\n/g, "\n");
});

describe("global Meta account linking migration", () => {
  it("updates account and connection atomically without storing credentials", () => {
    expect(migration).toContain("CREATE FUNCTION public.link_global_meta_account");
    expect(migration).toContain("INSERT INTO public.social_accounts");
    expect(migration).toContain("INSERT INTO public.social_connections AS target");
    expect(migration).toContain("provider_account_id = p_provider_account_id");
    expect(migration).not.toMatch(/access_token\s*=/i);
    expect(migration).not.toContain("secret_ref =");
  });

  it("uses existing uniqueness for idempotency and checks ownership/provider conflicts", () => {
    expect(migration).toContain("ON CONFLICT (user_id, platform, username) DO NOTHING");
    expect(migration).toContain("ON CONFLICT (social_account_id) DO UPDATE");
    expect(migration).toContain("v_connection.user_id <> p_user_id");
    expect(migration).toContain("v_account.provider NOT IN ('pending', 'meta')");
    expect(migration).toContain("v_connection.provider NOT IN ('pending', 'meta')");
  });

  it("is service-role only and uses a restricted SECURITY DEFINER search path", () => {
    expect(normalizedMigration).toContain("SECURITY DEFINER\nSET search_path = ''");
    expect(migration).toContain("REVOKE ALL ON public.social_connections FROM PUBLIC, anon, authenticated");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.link_global_meta_account(uuid, text, text) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.link_global_meta_account(uuid, text, text) TO service_role",
    );
  });

  it("contains no destructive table or data operations", () => {
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/);
  });
});
