import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { map, type Observable } from "rxjs";
import type { z } from "zod";

export const ZOD_RESPONSE_SCHEMA = Symbol("zod-response-schema");
export const NON_JSON_RESPONSE_KIND = Symbol("non-json-response-kind");

/** Declares and enforces the JSON response contract for one route. */
export const ZodResponse = (schema: z.ZodTypeAny): MethodDecorator =>
  SetMetadata(ZOD_RESPONSE_SCHEMA, schema);

/** Makes a non-JSON boundary explicit so completeness checks cannot miss it. */
export const NonJsonResponse = (
  kind: "redirect" | "empty" | "stream",
): MethodDecorator => SetMetadata(NON_JSON_RESPONSE_KIND, kind);

export class ZodResponseContractError extends Error {
  constructor(issueCount: number) {
    super(`API response violated its declared contract (${issueCount} issues)`);
    this.name = "ZodResponseContractError";
  }
}

/**
 * Parses controller results before Nest serializes them.
 *
 * Returning `parsed.data` is intentional: schema transforms and unknown-field
 * removal affect the actual wire value, rather than serving as a type-only
 * assertion. Invalid values fail closed as the existing generic 500 response;
 * neither the payload nor detailed issues are copied into the thrown error.
 */
@Injectable()
export class ZodResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.getAllAndOverride<z.ZodTypeAny>(
      ZOD_RESPONSE_SCHEMA,
      [context.getHandler(), context.getClass()],
    );
    if (!schema) return next.handle();

    return next.handle().pipe(
      map((value: unknown) => {
        const parsed = schema.safeParse(value);
        if (!parsed.success) {
          throw new ZodResponseContractError(parsed.error.issues.length);
        }
        return parsed.data;
      }),
    );
  }
}
