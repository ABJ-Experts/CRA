import { z } from "zod";

import { BASE_ROLES } from "./permissions.js";

export const customRoleSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    description: z.string().nullable(),
    color: z.string().min(1),
    baseRole: z.enum(BASE_ROLES),
    permissions: z.record(z.string(), z.boolean()),
    isSystem: z.boolean(),
    isActive: z.boolean(),
    memberCount: z.number().int().nonnegative(),
  })
  .strict();

export type CustomRole = z.infer<typeof customRoleSchema>;
