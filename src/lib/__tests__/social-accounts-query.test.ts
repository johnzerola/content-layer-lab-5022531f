import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOCIAL_ACCOUNT_SELECT } from "@/lib/social";

const socialSource = readFileSync(
  fileURLToPath(new URL("../social.ts", import.meta.url)),
  "utf8",
);
const publishDueSource = readFileSync(
  fileURLToPath(new URL("../../routes/api/public/hooks/publish-due.ts", import.meta.url)),
  "utf8",
);

describe("Cloud social schema query contract", () => {
  it("selects only confirmed social_accounts columns in listAccounts", () => {
    const selectedColumns = SOCIAL_ACCOUNT_SELECT.split(",");

    expect(selectedColumns).toEqual([
      "id",
      "platform",
      "username",
      "display_name",
      "avatar_url",
      "provider",
      "status",
      "provider_account_id",
      "created_at",
    ]);
  });

  it.each([
    ["social_accounts", "scopes"],
    ["social_accounts", "expires_at"],
    ["social_connections", "scopes"],
  ])("never accesses %s.%s in runtime queries", (table, column) => {
    const runtimeSources = `${socialSource}\n${publishDueSource}`;
    const tableQueries = runtimeSources.match(
      new RegExp(`\\.from\\(["']${table}["']\\)[\\s\\S]*?(?=;|\\n\\s*\\.from\\()`, "g"),
    );

    expect(tableQueries ?? []).not.toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`\\b${column}\\b`))]),
    );
  });
});
