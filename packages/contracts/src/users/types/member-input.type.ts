import type { z } from "zod";

import type {
  changeMemberRoleInputSchema,
  memberIdParamSchema,
  setMemberActiveInputSchema,
  updateProfileInputSchema,
} from "../schemas/index.js";

export type UpdateProfileInput = z.output<typeof updateProfileInputSchema>;
export type ChangeMemberRoleInput = z.output<
  typeof changeMemberRoleInputSchema
>;
export type SetMemberActiveInput = z.output<typeof setMemberActiveInputSchema>;
export type MemberIdParam = z.output<typeof memberIdParamSchema>;
