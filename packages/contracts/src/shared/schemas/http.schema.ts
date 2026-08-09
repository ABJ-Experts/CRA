import { z } from "zod";

/** The single error shape emitted by the API exception filter. */
export const apiErrorSchema = z
  .object({
    statusCode: z.number().int().positive(),
    message: z.string().min(1),
    code: z.string().min(1).optional(),
    fieldErrors: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/** Standard response for a successful command with no resource payload. */
export const okResponseSchema = z.object({ ok: z.literal(true) }).strict();

/** Standard response for a newly created UUID-backed resource. */
export const idResponseSchema = z.object({ id: z.uuid() }).strict();

/** Shared path parameter contract for UUID-backed resources. */
export const uuidParamSchema = z.uuid();
