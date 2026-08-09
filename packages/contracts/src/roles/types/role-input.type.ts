import type { z } from "zod";

import type {
  createRoleInputSchema,
  roleIdParamSchema,
  setRoleOverrideInputSchema,
  updateRoleInputSchema,
} from "../schemas/index.js";

export type CreateRoleInput = z.output<typeof createRoleInputSchema>;
export type UpdateRoleInput = z.output<typeof updateRoleInputSchema>;
export type SetRoleOverrideInput = z.output<typeof setRoleOverrideInputSchema>;
export type RoleIdParam = z.output<typeof roleIdParamSchema>;
