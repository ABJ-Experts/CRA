import type { z } from "zod";

import type { pagedSchema, pageParamsSchema } from "../schemas/index.js";

export type Paged<T> = z.output<ReturnType<typeof pagedSchema<T>>>;
export type PageParamsInput = z.input<typeof pageParamsSchema>;
export type PageParams = z.output<typeof pageParamsSchema>;
