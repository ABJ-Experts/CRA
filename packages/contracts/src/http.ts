import { z } from "zod";

/** The existing API error body. Success responses intentionally stay bare. */
export const apiErrorSchema = z
  .object({
    statusCode: z.number().int().positive(),
    message: z.string().min(1),
    code: z.string().min(1).optional(),
    fieldErrors: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
