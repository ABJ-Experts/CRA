import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { apiErrorSchema } from "@repo/contracts/shared/schemas";
import type { ApiErrorBody as SharedApiErrorBody } from "@repo/contracts/shared/types";
import type { Request, Response } from "express";

/** @deprecated Import from `@repo/contracts/shared/types`. */
export type ApiErrorBody = SharedApiErrorBody;

/**
 * The single shape every failed request returns.
 *
 * Deliberately matches `AuthResult` in `apps/web/app/(auth)/_components/auth-actions.ts`
 * so the frozen screens need no mapping layer: `message` renders in the
 * form-level alert and `fieldErrors` keys line up with the screens' own Zod
 * field names.
 *
 * There is NO success envelope anywhere in this API. The reference wraps every
 * response in `{statusCode, hasError, data, message}`; adopting that here would
 * make list endpoints differ in shape from `apps/web/mocks/handlers.ts`, which
 * returns `{rows,total,page,pageSize,pageCount}` bare — and the first table
 * swapped from MSW to the real API would break `use-table-query.ts`.
 */
interface HttpExceptionShape {
  message?: unknown;
  code?: unknown;
  fieldErrors?: unknown;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isSafeServerErrorCode(
  value: string | undefined,
): value is "unavailable" | "malformed_provider" {
  return value === "unavailable" || value === "malformed_provider";
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Something went wrong. Please try again.";
    let code: string | undefined;
    let fieldErrors: Record<string, string> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === "string") {
        message = response;
      } else if (response && typeof response === "object") {
        const shape = response as HttpExceptionShape;
        if (Array.isArray(shape.message)) {
          message =
            shape.message.find(
              (entry): entry is string => typeof entry === "string",
            ) ?? message;
        } else if (typeof shape.message === "string") {
          message = shape.message;
        }
        code = typeof shape.code === "string" ? shape.code : undefined;
        fieldErrors = isStringRecord(shape.fieldErrors)
          ? { ...shape.fieldErrors }
          : undefined;
      }
    }

    /*
     * A 5xx never reaches the client as anything but a generic sentence. An
     * internal message can carry a table name, a constraint, or a fragment of a
     * query — none of which the browser has any business seeing. The real error
     * goes to the log with the request id so it is still diagnosable.
     */
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const safeServerCode = isSafeServerErrorCode(code) ? code : undefined;
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      message = "Something went wrong. Please try again.";
      code = safeServerCode;
      fieldErrors = undefined;
    } else {
      /*
       * 4xx bodies are logged with IDs only — never the email, password, token
       * or cookie that produced them. A log that records the credential someone
       * typed is a second copy of the credential.
       */
      this.logger.warn(
        `${req.method} ${req.originalUrl} -> ${status} ${code ?? ""}`,
      );
    }

    const body: ApiErrorBody = apiErrorSchema.parse({
      statusCode: status,
      message,
      ...(code ? { code } : {}),
      ...(fieldErrors ? { fieldErrors } : {}),
    });

    res.status(status).json(body);
  }
}
