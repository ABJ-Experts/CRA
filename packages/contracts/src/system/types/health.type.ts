import type { z } from "zod";

import type {
  livenessResponseSchema,
  readinessResponseSchema,
} from "../schemas/index.js";

export type LivenessResponse = z.output<typeof livenessResponseSchema>;
export type ReadinessResponse = z.output<typeof readinessResponseSchema>;
