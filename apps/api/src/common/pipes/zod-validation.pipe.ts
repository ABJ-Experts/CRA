import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { ZodError, type z } from "zod";

/**
 * Validates a request body against a Zod schema from `@repo/contracts`.
 *
 * Zod rather than class-validator because the schemas are SHARED with the web
 * app: `apps/web/app/(auth)/*` already validates with these exact rules, and a
 * second, hand-maintained copy in decorators would drift. When it drifted, the
 * server would be laxer than the client — and the invite path could then mint an
 * account whose password the sign-in screen's own schema rejects.
 *
 * Emits `fieldErrors` keyed by the schema's field names, which is precisely what
 * the screens' `AuthResult.fieldErrors` expects, so no mapping layer is needed.
 */
@Injectable()
export class ZodValidationPipe<
  TSchema extends z.ZodTypeAny,
> implements PipeTransform<unknown, z.output<TSchema>> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException(toBadRequest(result.error));
  }
}

export function toBadRequest(error: ZodError): {
  message: string;
  code: string;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};

  for (const issue of error.issues) {
    const key = issue.path.join(".");
    // First message per field wins: the screens render one message under one
    // input, and showing the last of several reads as an arbitrary choice.
    if (key && !(key in fieldErrors)) fieldErrors[key] = issue.message;
  }

  return {
    message: error.issues[0]?.message ?? "That input is not valid.",
    code: "validation_failed",
    fieldErrors,
  };
}

/** Factory so controllers read as `@Body(zodBody(signInSchema)) dto: SignInInput`. */
export function zodBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
): ZodValidationPipe<TSchema> {
  return new ZodValidationPipe(schema);
}

/** Same parser for complete query objects and parameter objects. */
export const zodQuery = zodBody;
export const zodParams = zodBody;
