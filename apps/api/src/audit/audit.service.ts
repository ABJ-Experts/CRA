import { Injectable, Logger } from "@nestjs/common";

import { SupabaseService } from "../supabase/supabase.service";

export interface AuditEntry {
  organizationId: string | null;
  userId: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  /** jsonb. Typed loosely on purpose, but must stay JSON-serialisable. */
  changes?: Record<string, string | number | boolean | null>;
  ip?: string;
  userAgent?: string;
}

/**
 * Append-only record of security-relevant actions.
 *
 * TWO DELIBERATE PROPERTIES, both about not letting logging break the product:
 *
 *   1. `log()` never throws. A failed audit write must not fail the operation
 *      that triggered it — a user should not be unable to change a role because
 *      the log table is unavailable.
 *   2. Call sites use `void audit.log(...)` rather than awaiting, so a mutation
 *      does not pay a second round trip before responding.
 *
 * Both halves are needed: without the try/catch, an unawaited rejection becomes
 * an unhandled promise rejection and can take the process down.
 *
 * `actor_email` is denormalised because `user_id` is ON DELETE SET NULL — the
 * trail must still read after the actor is gone, which is the whole point of
 * keeping it when the user is deleted.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly supabase: SupabaseService) {}

  log(entry: AuditEntry): void {
    void this.write(entry);
  }

  private async write(entry: AuditEntry): Promise<void> {
    try {
      const { error } = await this.supabase
        .admin()
        .from("audit_logs")
        .insert({
          organization_id: entry.organizationId,
          user_id: entry.userId,
          actor_email: entry.actorEmail ?? null,
          action: entry.action,
          entity_type: entry.entityType ?? null,
          entity_id: entry.entityId ?? null,
          changes: entry.changes ?? null,
          ip_address: entry.ip ?? null,
          user_agent: entry.userAgent ?? null,
        });

      if (error) this.logger.error(`Audit write failed: ${error.message}`);
    } catch (error) {
      this.logger.error(
        `Audit write threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
