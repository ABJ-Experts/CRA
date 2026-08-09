import { BASE_ROLES } from "../../permissions.js";
import { z } from "zod";

const requestedPermissionsSchema = z.record(z.string(), z.boolean());

export const createRoleInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex colour like #4A50D6")
    .optional(),
  baseRole: z.enum(BASE_ROLES).default("member"),
  permissions: requestedPermissionsSchema.default({}),
});

export const updateRoleInputSchema = createRoleInputSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const setRoleOverrideInputSchema = z.object({
  baseRole: z.enum(BASE_ROLES),
  permissions: requestedPermissionsSchema,
});

export const roleIdParamSchema = z.object({ id: z.uuid() }).strict();
