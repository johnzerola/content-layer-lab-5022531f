import { describe, expect, it } from "vitest";
import { SOCIAL_ACCOUNT_SELECT } from "@/lib/social";

describe("social_accounts query contract", () => {
  it("never selects scopes from social_accounts", () => {
    const selectedColumns = SOCIAL_ACCOUNT_SELECT.split(",");

    expect(selectedColumns).not.toContain("scopes");
  });
});
