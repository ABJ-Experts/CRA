import type { z } from "zod";

import type { auditEventInputSchema } from "../schemas/index.js";

export type AuditEventInput = z.output<typeof auditEventInputSchema>;
