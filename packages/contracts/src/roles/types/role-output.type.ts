import type { z } from "zod";

import type {
  customRoleSchema,
  roleListResponseSchema,
  roleOverridesResponseSchema,
} from "../schemas/index.js";

export type CustomRole = z.output<typeof customRoleSchema>;
export type RoleListResponse = z.output<typeof roleListResponseSchema>;
export type RoleOverridesResponse = z.output<
  typeof roleOverridesResponseSchema
>;
