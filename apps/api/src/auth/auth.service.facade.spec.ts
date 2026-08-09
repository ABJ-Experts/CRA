import { HttpException } from "@nestjs/common";

import { AuthService } from "./auth.service";

const success = (value: unknown = undefined) => ({ ok: true, value });
const failed = (code: string) => ({ ok: false, error: { code } });
const execute = (result: unknown) => ({
  execute: jest.fn().mockResolvedValue(result),
});
const create = (index: number, result: unknown) => {
  const dependencies = Array.from({ length: 10 }, () => execute(success()));
  dependencies[index] = execute(result);
  return {
    service: new AuthService(
      ...(dependencies as unknown as ConstructorParameters<typeof AuthService>),
    ),
    dependency: dependencies[index],
  };
};
const response = async (work: Promise<unknown>) => {
  try {
    await work;
    throw new Error("expected failure");
  } catch (error) {
    return (error as HttpException).getResponse();
  }
};

describe("AuthService compatibility facade", () => {
  it("projects success responses and delegates every remaining public method", async () => {
    const signup = create(
      0,
      success({ tokens: { accessToken: "a", refreshToken: "r" }, userId: "u" }),
    );
    await expect(
      signup.service.signUp({
        email: "u@cra.test",
        username: "user",
        password: "Password123",
      }),
    ).resolves.toEqual({
      tokens: { access_token: "a", refresh_token: "r" },
      userId: "u",
    });
    const signin = create(
      1,
      success({
        tokens: { accessToken: "a", refreshToken: "r" },
        userId: "u",
        emailVerified: true,
      }),
    );
    await expect(
      signin.service.signIn({
        email: "u@cra.test",
        password: "Password123",
        remember: false,
      }),
    ).resolves.toMatchObject({ userId: "u", emailVerified: true });
    await expect(
      create(
        2,
        success({ accessToken: "a", refreshToken: "r" }),
      ).service.refresh("raw"),
    ).resolves.toEqual({ access_token: "a", refresh_token: "r" });
    await expect(
      create(3, success()).service.signOutEverywhere("u", "raw"),
    ).resolves.toBeUndefined();
    await expect(
      create(4, success()).service.issueVerificationCode("u", "u@cra.test"),
    ).resolves.toBeUndefined();
    await expect(
      create(6, success()).service.requestPasswordReset({
        email: "u@cra.test",
      }),
    ).resolves.toBeUndefined();
    const session = { user: {}, organization: null, organizations: [] };
    await expect(
      create(8, success(session)).service.session("u", null),
    ).resolves.toBe(session);
    await expect(
      create(9, success(true)).service.verifyPassword("u@cra.test", "password"),
    ).resolves.toBe(true);
  });

  it.each([
    ["username_taken", 409],
    ["email_taken", 409],
    ["profile_missing", 503],
    ["auth_unavailable", 503],
    ["otp_store_failed", 503],
    ["signup_failed", 400],
  ])("maps signup %s", async (code, status) => {
    const { service } = create(0, failed(code));
    await expect(
      service.signUp({
        email: "u@cra.test",
        username: "user",
        password: "Password123",
      }),
    ).rejects.toMatchObject({ status });
  });

  it("maps sign-in, refresh, revocation, issue, session and lock failures", async () => {
    expect(
      await response(
        create(1, failed("account_locked")).service.signIn({
          email: "u@cra.test",
          password: "Password123",
          remember: false,
        }),
      ),
    ).toMatchObject({ code: "account_locked" });
    expect(
      await response(
        create(1, failed("invalid_credentials")).service.signIn({
          email: "u@cra.test",
          password: "Password123",
          remember: false,
        }),
      ),
    ).toMatchObject({ code: "invalid_credentials" });
    expect(
      await response(
        create(1, failed("auth_unavailable")).service.signIn({
          email: "u@cra.test",
          password: "Password123",
          remember: false,
        }),
      ),
    ).toMatchObject({ code: "auth_unavailable" });
    expect(
      await response(
        create(2, failed("refresh_failed")).service.refresh("raw"),
      ),
    ).toMatchObject({ code: "refresh_failed" });
    expect(
      await response(
        create(2, failed("auth_unavailable")).service.refresh("raw"),
      ),
    ).toMatchObject({ code: "auth_unavailable" });
    expect(
      await response(
        create(3, failed("revoke_failed")).service.signOutEverywhere(
          "u",
          "raw",
        ),
      ),
    ).toMatchObject({ code: "revoke_failed" });
    expect(
      await response(
        create(4, failed("otp_store_failed")).service.issueVerificationCode(
          "u",
          "u@cra.test",
        ),
      ),
    ).toMatchObject({ code: "otp_store_failed" });
    expect(
      await response(
        create(8, failed("profile_missing")).service.session("u", null),
      ),
    ).toMatchObject({ code: "profile_missing" });
    expect(
      await response(
        create(9, failed("account_locked")).service.verifyPassword(
          "u@cra.test",
          "password",
        ),
      ),
    ).toMatchObject({ code: "account_locked" });
    expect(
      await response(
        create(9, failed("auth_unavailable")).service.verifyPassword(
          "u@cra.test",
          "password",
        ),
      ),
    ).toMatchObject({ code: "auth_unavailable" });
  });
});
