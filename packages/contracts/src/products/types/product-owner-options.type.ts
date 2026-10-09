import type { z } from "zod";
import type {
  productOwnerOptionSchema,
  productOwnerOptionsQuerySchema,
  productOwnerOptionsResponseSchema,
} from "../schemas/product-owner-options.schema.js";
export type ProductOwnerOption = z.output<typeof productOwnerOptionSchema>;
export type ProductOwnerOptionsQuery = z.output<
  typeof productOwnerOptionsQuerySchema
>;
export type ProductOwnerOptionsResponse = z.output<
  typeof productOwnerOptionsResponseSchema
>;
