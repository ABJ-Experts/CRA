import { HttpStatus } from "@nestjs/common";

import { TooManyRequestsException } from "./too-many-requests.exception";

describe("TooManyRequestsException", () => {
  it("preserves retry semantics and a machine-readable code", () => {
    const response = {
      message: "Too many attempts. Please try again later.",
      code: "account_locked",
    };
    const exception = new TooManyRequestsException(response);

    expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(exception.getResponse()).toEqual(response);
  });

  it("accepts a message when no domain code applies", () => {
    const exception = new TooManyRequestsException({ message: "Slow down." });

    expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(exception.getResponse()).toEqual({ message: "Slow down." });
  });
});
