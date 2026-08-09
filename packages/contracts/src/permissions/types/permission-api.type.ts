import type { z } from "zod";

import type {
  checkPermissionsInputSchema,
  checkPermissionsResponseSchema,
  effectivePermissionsResponseSchema,
  menuResponseSchema,
  permissionCatalogueResponseSchema,
  permissionSetSchema,
} from "../schemas/index.js";

export type PermissionSetOutput = z.output<typeof permissionSetSchema>;
export type CheckPermissionsInput = z.output<
  typeof checkPermissionsInputSchema
>;
export type EffectivePermissionsResponse = z.output<
  typeof effectivePermissionsResponseSchema
>;
export type MenuResponse = z.output<typeof menuResponseSchema>;
export type CheckPermissionsResponse = z.output<
  typeof checkPermissionsResponseSchema
>;
export type PermissionCatalogueResponse = z.output<
  typeof permissionCatalogueResponseSchema
>;
