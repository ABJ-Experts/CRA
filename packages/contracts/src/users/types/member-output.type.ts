import type { z } from "zod";

import type {
  memberListResponseSchema,
  memberRoleSummarySchema,
  memberSchema,
} from "../schemas/index.js";

export type MemberRoleSummary = z.output<typeof memberRoleSummarySchema>;
export type Member = z.output<typeof memberSchema>;
export type MemberListResponse = z.output<typeof memberListResponseSchema>;
