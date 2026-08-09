import { z } from "zod";

export const livenessResponseSchema = z
  .object({
    status: z.literal("ok"),
    uptime: z.number().int().nonnegative(),
  })
  .strict();

export const readinessResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    database: z.boolean(),
  })
  .strict();
