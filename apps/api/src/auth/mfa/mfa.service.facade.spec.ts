import { HttpException } from "@nestjs/common";

import { MfaService } from "./mfa.service";

const success = (value: unknown = undefined) => ({ ok: true, value });
const failed = (code: string) => ({ ok: false, error: { code } });
const execute = (result: unknown) => ({
  execute: jest.fn().mockResolvedValue(result),
});
const create = (index: number, result: unknown) => {
  const dependencies = Array.from({ length: 6 }, () => execute(success()));
  dependencies[index] = execute(result);
  return new MfaService(
    ...(dependencies as unknown as ConstructorParameters<typeof MfaService>),
  );
};
const response = async (work: Promise<unknown>) => {
  try {
    await work;
    throw new Error("expected failure");
  } catch (error) {
    return (error as HttpException).getResponse();
  }
};

describe("MfaService compatibility facade", () => {
  it("maps all success responses", async () => {
    await expect(
      create(
        0,
        success({ factorId: "f", qrCode: "q", secret: "s", uri: "u" }),
      ).enroll("raw"),
    ).resolves.toMatchObject({ factorId: "f" });
    await expect(
      create(
        1,
        success({
          recoveryCodes: ["abcd-ef12"],
          tokens: { accessToken: "a", refreshToken: "r" },
        }),
      ).confirmEnrollment("raw", "u", "f", "123456"),
    ).resolves.toEqual({
      recoveryCodes: ["abcd-ef12"],
      tokens: { access_token: "a", refresh_token: "r" },
    });
    await expect(
      create(2, success({ accessToken: "a", refreshToken: "r" })).verify(
        "raw",
        "u",
        "123456",
      ),
    ).resolves.toEqual({ access_token: "a", refresh_token: "r" });
    await expect(
      create(4, success(true)).hasVerifiedFactor("raw"),
    ).resolves.toBe(true);
    await expect(
      create(5, success()).unenroll("raw", "u", "f"),
    ).resolves.toBeUndefined();
  });

  it.each([
    "mfa_challenge_failed",
    "mfa_invalid_code",
    "auth_unavailable",
    "mfa_recovery_generate_failed",
  ])("maps enrollment failure %s", async (code) => {
    expect(
      await response(
        create(1, failed(code)).confirmEnrollment("raw", "u", "f", "123456"),
      ),
    ).toMatchObject({ code });
  });

  it.each([
    "mfa_factors_failed",
    "mfa_not_enrolled",
    "mfa_challenge_failed",
    "mfa_invalid_code",
    "auth_unavailable",
  ])("maps verification failure %s", async (code) => {
    expect(
      await response(create(2, failed(code)).verify("raw", "u", "123456")),
    ).toMatchObject({ code });
  });

  it("maps enroll, factor lookup, and unenroll failures", async () => {
    expect(
      await response(create(0, failed("mfa_enroll_failed")).enroll("raw")),
    ).toMatchObject({ code: "mfa_enroll_failed" });
    expect(
      await response(create(0, failed("auth_unavailable")).enroll("raw")),
    ).toMatchObject({ code: "auth_unavailable" });
    expect(
      await response(
        create(4, failed("auth_unavailable")).hasVerifiedFactor("raw"),
      ),
    ).toMatchObject({ code: "auth_unavailable" });
    expect(
      await response(
        create(5, failed("mfa_unenroll_failed")).unenroll("raw", "u", "f"),
      ),
    ).toMatchObject({ code: "mfa_unenroll_failed" });
    expect(
      await response(
        create(5, failed("auth_unavailable")).unenroll("raw", "u", "f"),
      ),
    ).toMatchObject({ code: "auth_unavailable" });
  });
});
