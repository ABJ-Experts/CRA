import { MENU_KEYS } from "../../menu.js";
import { BASE_ROLES, PERMISSION_KEYS } from "../../permissions.js";
import { z } from "zod";

export const baseRoleSchema = z.enum(BASE_ROLES);
export const permissionKeySchema = z.enum(PERMISSION_KEYS);
export const permissionSetSchema = z.partialRecord(
  permissionKeySchema,
  z.boolean(),
);

export const checkPermissionsInputSchema = z.object({
  permissions: z.array(z.string()).min(1).max(50),
});

export const effectivePermissionsResponseSchema = z
  .object({
    organizationId: z.uuid().nullable(),
    role: baseRoleSchema.nullable(),
    permissions: permissionSetSchema,
  })
  .strict();

export const menuResponseSchema = z
  .object({ menu: z.array(z.enum(MENU_KEYS)) })
  .strict();

export const checkPermissionsResponseSchema = z
  .object({ results: z.record(z.string(), z.boolean()) })
  .strict();

export const permissionCatalogueResponseSchema = z
  .object({ permissions: z.array(permissionKeySchema) })
  .strict();
