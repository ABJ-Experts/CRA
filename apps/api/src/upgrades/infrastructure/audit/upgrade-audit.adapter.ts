import { redactAuditMetadata } from "../../../audit/audit-redaction";
import type { JournalRecord } from "../journal/upgrade-host-journal";

export interface UpgradeAuditFact {
  readonly record: JournalRecord;
  readonly actorId: string;
  readonly action: string;
  readonly outcome: "intent" | "completed" | "failed" | "denied" | "cancelled";
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface UpgradeAuditRpc {
  rpc(
    name: "m13_01_append_audit_event",
    args: Readonly<Record<string, unknown>>,
  ): PromiseLike<{
    data: readonly { outcome: string; audit_id: string }[] | null;
    error: unknown;
  }>;
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Only authenticated, already durable journal facts enter this awaited replayable sink. */
export class UpgradeAuditAdapter {
  constructor(
    private readonly client: UpgradeAuditRpc,
    private readonly authenticateFact: (
      fact: UpgradeAuditFact,
    ) => Promise<void>,
  ) {}
  async append(
    fact: UpgradeAuditFact,
  ): Promise<{ outcome: "inserted" | "replayed"; auditId: string }> {
    const { record } = fact;
    if (
      !["intent", "completed", "failed", "denied", "cancelled"].includes(
        fact.outcome,
      ) ||
      !uuid.test(record.runId) ||
      !uuid.test(fact.actorId) ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence < 1 ||
      !/^upgrade\.[a-z][a-z._]{0,99}$/.test(fact.action)
    )
      throw new Error("upgrade_audit_invalid");
    await this.authenticateFact(fact);
    // Explicit safe projection: neither raw journal data nor arbitrary caller keys reach SQL.
    const safe = redactAuditMetadata(
      Object.fromEntries(
        Object.entries(fact.metadata).filter(([key]) =>
          [
            "runId",
            "requestId",
            "version",
            "reasonCode",
            "stage",
            "state",
            "status",
            "outcome",
            "verified",
            "count",
          ].includes(key),
        ),
      ),
    );
    const { data, error } = await this.client.rpc("m13_01_append_audit_event", {
      p_organization_id: null,
      p_scope: "security",
      p_event_key: `upgrade:${record.runId}:${record.sequence}`,
      p_actor_type: "operator",
      p_actor_id: fact.actorId,
      p_user_id: null,
      p_action: fact.action,
      p_entity_type: "upgrade",
      p_entity_id: record.runId,
      p_outcome: fact.outcome,
      p_correlation_id: record.runId,
      p_before_redacted: null,
      p_after_redacted: safe,
      p_reason: null,
      p_ip_address: null,
      p_user_agent: null,
    });
    const row = data?.[0];
    if (
      error ||
      data?.length !== 1 ||
      !row ||
      !uuid.test(row.audit_id) ||
      (row.outcome !== "inserted" && row.outcome !== "replayed")
    )
      throw new Error("upgrade_audit_unavailable");
    return { outcome: row.outcome, auditId: row.audit_id };
  }
}
