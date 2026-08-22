import { describe, expect, it } from "vitest";
import { parseAddAccountInput } from "@/lib/social.functions";

describe("addAccount input validation", () => {
  it("preserves a valid Instagram username", () => {
    expect(parseAddAccountInput({ username: "@suapagina" })).toEqual({
      username: "@suapagina",
    });
  });

  it.each([undefined, null, {}, { username: "" }, { username: 42 }])(
    "turns an invalid payload into a handled empty username instead of throwing (%j)",
    (payload) => {
      expect(() => parseAddAccountInput(payload)).not.toThrow();
      expect(parseAddAccountInput(payload)).toEqual({ username: "" });
    },
  );
});
