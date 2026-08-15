import { describe, expect, it, vi } from "vitest";

const cloudState = vi.hoisted(() => ({ accounts: [] as Array<Record<string, unknown>> }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== "social_accounts") throw new Error(`unexpected table: ${table}`);
      return {
        select: vi.fn(() => ({
          order: vi.fn(async () => ({ data: cloudState.accounts, error: null })),
        })),
      };
    }),
  },
}));

import { executeInstagramAccountLink } from "@/lib/social-linking.server";
import { persistValidatedMetaAccount } from "@/lib/social-persistence.server";
import { listAccounts, resolveAccountLinkUi } from "@/lib/social";

describe("Agenda Add Meta flow against the Cloud contract", () => {
  it("validates Meta, calls the real RPC contract, updates UI and reloads the account", async () => {
    cloudState.accounts = [];
    const rpc = vi.fn(async (_name, args) => {
      const account = {
        id: "account-1",
        platform: "instagram",
        username: args.p_username,
        display_name: null,
        avatar_url: null,
        provider: "meta",
        provider_account_id: args.p_provider_account_id,
        status: "conectado",
        created_at: "2026-08-15T00:00:00.000Z",
      };
      cloudState.accounts = [account];
      return { data: [account], error: null };
    });

    const result = await executeInstagramAccountLink({
      userId: "user-1",
      requestedHandle: "@madereiracarvalhos",
      environment: {
        META_ACCESS_TOKEN: "test-token",
        META_IG_USER_ID: "ig-123",
        META_GRAPH_VERSION: "v26.0",
      },
      fetch: vi.fn(async (url) => {
        expect(String(url)).toBe(
          "https://graph.instagram.com/v26.0/me?fields=id,username",
        );
        return new Response(
          JSON.stringify({ id: "ig-123", username: "madereiracarvalhos" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
      persist: (input) => persistValidatedMetaAccount(rpc, input),
    });

    const ui = resolveAccountLinkUi([], result);
    const reloaded = await listAccounts();

    expect(rpc).toHaveBeenCalledWith("link_global_meta_account", {
      p_user_id: "user-1",
      p_username: "madereiracarvalhos",
      p_provider_account_id: "ig-123",
    });
    expect(ui).toMatchObject({
      ok: true,
      accounts: [{ provider: "meta", provider_account_id: "ig-123", status: "conectado" }],
    });
    expect(reloaded).toEqual(ui.ok ? ui.accounts : []);
  });
});
