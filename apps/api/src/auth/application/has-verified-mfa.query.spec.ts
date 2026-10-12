import {
  AuthIdentitySessionInvalidError,
  type AuthIdentityProvider,
} from "./auth-identity-provider.port";
import { HasVerifiedMfaQuery } from "./has-verified-mfa.query";

describe("HasVerifiedMfaQuery", () => {
  const create = (
    listUserMfaFactors: AuthIdentityProvider["listUserMfaFactors"],
  ) => new HasVerifiedMfaQuery({ listUserMfaFactors } as AuthIdentityProvider);

  it.each([
    [[{ id: "verified", status: "verified" }], true],
    [[{ id: "pending", status: "unverified" }], false],
    [[], false],
  ])(
    "reports verified factors without changing provider values",
    async (factors, expected) => {
      const list = jest.fn().mockResolvedValue(factors);
      expect(
        await create(list).execute({ accessToken: "isolated-token" }),
      ).toEqual({
        ok: true,
        value: expected,
      });
      expect(list).toHaveBeenCalledWith("isolated-token");
    },
  );

  it("keeps missing provider responses unavailable", async () => {
    expect(
      await create(jest.fn().mockResolvedValue(null)).execute({
        accessToken: "token",
      }),
    ).toEqual({ ok: false, error: { code: "auth_unavailable" } });
  });

  it.each([
    [new AuthIdentitySessionInvalidError(), "session_revoked"],
    [new Error("provider unavailable"), "auth_unavailable"],
  ])("distinguishes a revoked session from an outage", async (error, code) => {
    expect(
      await create(jest.fn().mockRejectedValue(error)).execute({
        accessToken: "token",
      }),
    ).toEqual({ ok: false, error: { code } });
  });
});
