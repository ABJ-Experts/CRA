import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";

import { TooManyRequestsException } from "../common/exceptions/too-many-requests.exception";
import { AuthService } from "./auth.service";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function createService(result: unknown) {
  const execute = jest.fn().mockResolvedValue(result);
  return {
    execute,
    service: new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { execute } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ),
  };
}

async function captureError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    throw new Error("Expected operation to fail");
  } catch (error) {
    return error;
  }
}

describe("AuthService.verifyEmailCode facade", () => {
  it("keeps the public signature while delegating to the atomic use case", async () => {
    const { service, execute } = createService({
      ok: true,
      value: undefined,
    });

    await expect(
      service.verifyEmailCode(USER_ID, "123456"),
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith({ userId: USER_ID, code: "123456" });
  });

  it.each([
    [
      "otp_missing",
      BadRequestException,
      "That code is not right. Request a new one.",
    ],
    [
      "otp_expired",
      BadRequestException,
      "That code has expired. Request a new one.",
    ],
    [
      "otp_attempts_exhausted",
      TooManyRequestsException,
      "Too many attempts. Request a new code.",
    ],
    [
      "otp_invalid",
      BadRequestException,
      "That code is not right. Check it and try again.",
    ],
    [
      "email_verification_failed",
      ServiceUnavailableException,
      "We could not finish verifying your email. Please try again.",
    ],
  ] as const)(
    "preserves the %s transport response",
    async (code, Type, message) => {
      const { service } = createService({ ok: false, error: { code } });

      const error = await captureError(
        service.verifyEmailCode(USER_ID, "123456"),
      );

      expect(error).toBeInstanceOf(Type);
      expect((error as BadRequestException).getResponse()).toEqual({
        message,
        code,
      });
    },
  );

  it("never logs a verification code", async () => {
    const log = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const { service } = createService({
      ok: false,
      error: { code: "email_verification_failed" },
    });

    await expect(
      service.verifyEmailCode(USER_ID, "secret-code"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(log.mock.calls.flat().join(" ")).not.toContain("secret-code");
    log.mockRestore();
  });
});
