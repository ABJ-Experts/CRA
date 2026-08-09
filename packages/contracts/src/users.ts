import { z } from "zod";

import { BASE_ROLES } from "./permissions.js";

export const memberRoleSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    color: z.string().min(1),
  })
  .strict();

export const memberSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    username: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    jobTitle: z.string().nullable(),
    isActive: z.boolean(),
    role: z.enum(BASE_ROLES),
    joinedAt: z.iso.datetime({ offset: true }),
    roles: z.array(memberRoleSummarySchema),
  })
  .strict();

export type MemberRoleSummary = z.infer<typeof memberRoleSummarySchema>;
export type Member = z.infer<typeof memberSchema>;
