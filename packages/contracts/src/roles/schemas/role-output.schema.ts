import { BASE_ROLES } from "../../permissions.js";
import { permissionSetSchema } from "../../permissions/schemas/index.js";
import { z } from "zod";

export const customRoleSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    description: z.string().nullable(),
    color: z.string().min(1),
    baseRole: z.enum(BASE_ROLES),
    permissions: permissionSetSchema,
    isSystem: z.boolean(),
    isActive: z.boolean(),
    memberCount: z.number().int().nonnegative(),
  })
  .strict();

export const roleListResponseSchema = z
  .object({ rows: z.array(customRoleSchema) })
  .strict();

export const roleOverridesResponseSchema = z
  .object({
    overrides: z.partialRecord(z.enum(BASE_ROLES), permissionSetSchema),
  })
  .strict();
