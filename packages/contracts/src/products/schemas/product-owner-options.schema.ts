import { z } from "zod";
import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";
export const productOwnerOptionSchema = z
  .object({ id: z.uuid(), displayName: z.string().min(1).max(300) })
  .strict();
export const productOwnerOptionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    selectedOwnerId: z.uuid().optional(),
    productId: z.uuid().optional(),
  })
  .strict()
  .refine((query) => !(query.productId && query.selectedOwnerId), {
    message: "Use either a product owner label or the owner directory.",
  });
export const productOwnerOptionsResponseSchema = z
  .object({
    owners: pagedSchema(productOwnerOptionSchema),
    selectedOwner: productOwnerOptionSchema.nullable(),
  })
  .strict();
