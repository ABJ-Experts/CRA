import { Injectable, Logger } from "@nestjs/common";
import { auditEventInputSchema } from "@repo/contracts/audit/schemas";
import type { AuditEventInput } from "@repo/contracts/audit/types";

import { SupabaseService } from "../supabase/supabase.service";
import type { Database } from "../supabase/database.types";
import { redactAuditMetadata } from "./audit-redaction";

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
 * The legacy `log()` path deliberately remains best-effort for callers whose
 * response semantics have not yet been migrated. `recordV2()` is durable and
 * throws when a critical event cannot be committed.
 *
 * Existing `log()` callers use fire-and-forget writes. Its catch prevents an
 * unhandled rejection; critical operations use transactional writers instead.
 *
 * `actor_email` is denormalised because `user_id` is ON DELETE SET NULL — the
 * trail must still read after the actor is gone, which is the whole point of
 * keeping it when the user is deleted.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private lastWriteFailed = false;

  constructor(private readonly supabase: SupabaseService) {}

  log(entry: AuditEntry): void {
    void this.write(entry);
  }

  async recordV2(
    orgId: string | null,
    event: AuditEventInput,
  ): Promise<{
    outcome: "inserted" | "replayed";
    auditId: string;
  }> {
    if (orgId !== event.organizationId)
      throw new Error("audit organization scope mismatch");
    const parsed = auditEventInputSchema.parse({
      ...event,
      beforeRedacted: redactAuditMetadata(event.beforeRedacted),
      afterRedacted: redactAuditMetadata(event.afterRedacted),
      userAgent: null,
    });
    try {
      // Supabase's generated RPC Args omit SQL nullable annotations. The
      // envelope schema and the SQL function enforce the actual nullable shape.
      const args = {
        p_organization_id: parsed.organizationId,
        p_scope: parsed.scope,
        p_event_key: parsed.eventKey,
        p_actor_type: parsed.actorType,
        p_actor_id: parsed.actorId,
        p_user_id: parsed.userId,
        p_action: parsed.action,
        p_entity_type: parsed.entityType,
        p_entity_id: parsed.entityId,
        p_outcome: parsed.outcome,
        p_correlation_id: parsed.correlationId,
        p_before_redacted: parsed.beforeRedacted,
        p_after_redacted: parsed.afterRedacted,
        p_reason: parsed.reason,
        p_ip_address: parsed.ipAddress,
        p_user_agent: parsed.userAgent,
      } as unknown as Database["public"]["Functions"]["m13_01_append_audit_event"]["Args"];
      const { data, error } = await this.supabase
        .admin()
        .rpc("m13_01_append_audit_event", args);
      if (
        error ||
        !data ||
        data.length !== 1 ||
        data[0]?.outcome === "conflict"
      ) {
        if (data?.[0]?.outcome === "conflict")
          throw new Error("audit event conflict");
        throw new Error("audit write unavailable");
      }
      const row = data[0];
      if (
        !row ||
        (row.outcome !== "inserted" && row.outcome !== "replayed") ||
        !row.audit_id
      )
        throw new Error("audit write unavailable");
      this.lastWriteFailed = false;
      return { outcome: row.outcome, auditId: row.audit_id };
    } catch (error) {
      this.lastWriteFailed = true;
      this.logger.error("Durable audit append failed");
      throw error;
    }
  }

  async isReady(): Promise<boolean> {
    if (this.lastWriteFailed) return false;
    try {
      const { error } = await this.supabase
        .admin()
        .from("audit_logs")
        .select("id")
        .limit(1);
      return !error;
    } catch {
      return false;
    }
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

      if (error) {
        this.lastWriteFailed = true;
        this.logger.error("Audit write failed");
      } else {
        this.lastWriteFailed = false;
      }
    } catch {
      this.lastWriteFailed = true;
      this.logger.error("Audit write failed");
    }
  }
}
