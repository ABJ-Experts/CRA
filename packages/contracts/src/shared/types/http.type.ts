import type { z } from "zod";

import type {
  apiErrorSchema,
  idResponseSchema,
  okResponseSchema,
  uuidParamSchema,
} from "../schemas/index.js";

export type ApiErrorBody = z.output<typeof apiErrorSchema>;
export type OkResponse = z.output<typeof okResponseSchema>;
export type IdResponse = z.output<typeof idResponseSchema>;
export type UuidParam = z.output<typeof uuidParamSchema>;
