import { BASE_ROLES } from "../../permissions.js";
import { z } from "zod";

export const updateProfileInputSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  language: z.string().trim().max(10).optional(),
});

export const changeMemberRoleInputSchema = z.object({
  role: z.enum(BASE_ROLES),
});

export const setMemberActiveInputSchema = z.object({
  isActive: z.boolean(),
});

export const memberIdParamSchema = z.object({ id: z.uuid() }).strict();
