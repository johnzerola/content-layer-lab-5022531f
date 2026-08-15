import { describe, expect, it, vi } from "vitest";
import { persistValidatedMetaAccount } from "@/lib/social-persistence.server";

const linkedAccount = {
  id: "account-1",
  platform: "instagram",
  username: "madereiracarvalhos",
  display_name: null,
  avatar_url: null,
  provider: "meta",
  provider_account_id: "ig-123",
  status: "conectado",
  created_at: "2026-08-15T00:00:00.000Z",
};

describe("applied Meta linking RPC contract", () => {
  it("calls the applied RPC with its exact name and server-validated values", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [linkedAccount], error: null });

    const result = await persistValidatedMetaAccount(rpc, {
      userId: "user-1",
      handle: "madereiracarvalhos",
      providerAccountId: "ig-123",
    });

    expect(rpc).toHaveBeenCalledWith("link_global_meta_account", {
      p_user_id: "user-1",
      p_username: "madereiracarvalhos",
      p_provider_account_id: "ig-123",
    });
    expect(result).toEqual(linkedAccount);
  });

  it("never reports a connected account when the RPC fails", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "database unavailable" } });

    await expect(
      persistValidatedMetaAccount(rpc, {
        userId: "user-1",
        handle: "madereiracarvalhos",
        providerAccountId: "ig-123",
      }),
    ).rejects.toMatchObject({ code: "DATABASE_ERROR" });
  });

  it.each([
    ["account ownership mismatch", "ACCOUNT_OWNERSHIP_INVALID"],
    ["provider conflict", "PROVIDER_CONFLICT"],
  ])("sanitizes RPC error %s", async (message, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message } });

    await expect(
      persistValidatedMetaAccount(rpc, {
        userId: "user-1",
        handle: "madereiracarvalhos",
        providerAccountId: "ig-123",
      }),
    ).rejects.toMatchObject({ code });
  });
});
