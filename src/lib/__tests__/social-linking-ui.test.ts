import { describe, expect, it } from "vitest";
import { resolveAccountLinkUi, type SocialAccount } from "@/lib/social";

const pending: SocialAccount = {
  id: "account-1",
  platform: "instagram",
  username: "madereiracarvalhos",
  display_name: null,
  avatar_url: null,
  provider: "pending",
  provider_account_id: null,
  status: "aguardando provedor",
  created_at: "2026-08-15T00:00:00.000Z",
};

describe("Agenda account linking result handling", () => {
  it("replaces a pending account immediately after a successful Add", () => {
    const result = resolveAccountLinkUi([pending], {
      ok: true,
      account: {
        ...pending,
        provider: "meta",
        provider_account_id: "ig-123",
        status: "conectado",
      },
    });

    expect(result).toEqual({
      ok: true,
      accounts: [
        expect.objectContaining({
          id: "account-1",
          provider: "meta",
          provider_account_id: "ig-123",
          status: "conectado",
        }),
      ],
    });
  });

  it("adds a newly created account without requiring a page refresh", () => {
    const result = resolveAccountLinkUi([], {
      ok: true,
      account: {
        ...pending,
        provider: "meta",
        provider_account_id: "ig-123",
        status: "conectado",
      },
    });

    expect(result.ok && result.accounts).toHaveLength(1);
  });

  it("preserves the current list and exposes the server error when ok is false", () => {
    const result = resolveAccountLinkUi([pending], {
      ok: false,
      code: "META_AUTH_INVALID",
      error: "A autorização do Instagram é inválida ou expirou.",
    });

    expect(result).toEqual({
      ok: false,
      error: "A autorização do Instagram é inválida ou expirou.",
    });
  });
});
