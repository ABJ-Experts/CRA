import { HttpException } from "@nestjs/common";
import { LicensingError } from "../application/licensing.errors";
import { licensingHttp, licensingHttpException } from "./licensing-http";

describe("licensing HTTP boundary", () => {
  it.each([
    new LicensingError(
      "license_read_only",
      403,
      "Customer writes are paused",
      "expired",
    ),
    new LicensingError("license_conflict", 409, "Reload and try again"),
  ])("preserves safe policy status, code and optional reason", (error) => {
    const result = licensingHttpException(error);
    expect(result).toBeInstanceOf(HttpException);
    expect(result.getStatus()).toBe(error.status);
    expect(result.getResponse()).toEqual({
      code: error.code,
      message: error.message,
      ...(error.reason ? { details: { reason: error.reason } } : {}),
    });
  });

  it("returns successful application results unchanged", async () => {
    const result = { version: 2 };
    await expect(licensingHttp(() => Promise.resolve(result))).resolves.toBe(
      result,
    );
  });

  it("maps application denials without collapsing conflicts into unavailability", async () => {
    const error = new LicensingError(
      "license_conflict",
      409,
      "Reload",
      "version",
    );
    try {
      await licensingHttp(() => Promise.reject(error));
      throw new Error("Expected conflict");
    } catch (result) {
      expect(result).toBeInstanceOf(HttpException);
      expect((result as HttpException).getStatus()).toBe(409);
      expect((result as HttpException).getResponse()).toEqual({
        code: "license_conflict",
        message: "Reload",
        details: { reason: "version" },
      });
    }
  });

  it("preserves unrelated failures for the existing error boundary", async () => {
    const failure = new Error("database unavailable");
    await expect(licensingHttp(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });
});
