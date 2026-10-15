import {
  backupCustomerHistorySchema,
  backupHistoryQuerySchema,
} from "@repo/contracts/backups/schemas";
import type { z } from "zod";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";

/** Scope is a presentation cache key; verified server identity owns authorization. */
export class BackupAssuranceGateway {
  constructor(private readonly request = authenticatedRequestJson) {}
  async history(
    _organizationId: string,
    input: z.input<typeof backupHistoryQuerySchema> = {},
    signal?: AbortSignal,
  ) {
    const query = backupHistoryQuerySchema.parse(input);
    const params = new URLSearchParams({
      limit: String(query.limit),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    });
    return this.request({
      path: `/api/v1/system/backups/runs?${params}`,
      method: "GET",
      signal,
      schema: backupCustomerHistorySchema,
    });
  }
}
export const backupAssuranceGateway = new BackupAssuranceGateway();
