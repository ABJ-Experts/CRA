import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";

import { AllExceptionsFilter } from "./all-exceptions.filter";

function fixture() {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();
  const request = { method: "POST", originalUrl: "/api/v1/widgets" };
  const response = { status, json };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { filter: new AllExceptionsFilter(), host, status, json };
}

describe("AllExceptionsFilter", () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    error = jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("preserves a safe string response from a client error", () => {
    const { filter, host, status, json } = fixture();

    filter.catch(new BadRequestException("Choose another value"), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Choose another value",
    });
    expect(warn).toHaveBeenCalledWith("POST /api/v1/widgets -> 400 ");
    expect(error).not.toHaveBeenCalled();
  });

  it("returns the first validation message with code and field errors", () => {
    const { filter, host, json } = fixture();
    const fieldErrors = { email: "Enter a valid email" };

    filter.catch(
      new HttpException(
        {
          message: ["Enter a valid email", "A second message"],
          code: "validation_failed",
          fieldErrors,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: "Enter a valid email",
      code: "validation_failed",
      fieldErrors,
    });
    expect(warn).toHaveBeenCalledWith(
      "POST /api/v1/widgets -> 422 validation_failed",
    );
  });

  it("uses the safe default when a client exception has no message", () => {
    const { filter, host, json } = fixture();

    filter.catch(new HttpException({}, HttpStatus.CONFLICT), host);

    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      message: "Something went wrong. Please try again.",
    });
  });

  it("uses the safe default when a message array is empty", () => {
    const { filter, host, json } = fixture();

    filter.catch(
      new HttpException({ message: [] }, HttpStatus.BAD_REQUEST),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Something went wrong. Please try again.",
    });
  });

  it("drops malformed exception metadata before parsing the error contract", () => {
    const { filter, host, json } = fixture();

    expect(() =>
      filter.catch(
        new HttpException(
          {
            message: [42, "Choose another value"],
            code: 99,
            fieldErrors: { email: 42 },
          },
          HttpStatus.BAD_REQUEST,
        ),
        host,
      ),
    ).not.toThrow();
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Choose another value",
    });
  });

  it("removes internal messages and metadata from server errors", () => {
    const { filter, host, status, json } = fixture();
    const exception = new HttpException(
      {
        message: "duplicate value violates widgets_email_key",
        code: "database_error",
        fieldErrors: { email: "secret detail" },
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: "Something went wrong. Please try again.",
    });
    expect(error).toHaveBeenCalledWith(
      "POST /api/v1/widgets -> 503",
      exception.stack,
    );
  });

  it("sanitizes and stringifies a non-Error thrown value", () => {
    const { filter, host, json } = fixture();

    filter.catch("database unavailable", host);

    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Something went wrong. Please try again.",
    });
    expect(error).toHaveBeenCalledWith(
      "POST /api/v1/widgets -> 500",
      "database unavailable",
    );
  });
});
