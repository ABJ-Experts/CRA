import { randomUUID } from "node:crypto";
import type { ClamAvScannerAdapter } from "../infrastructure/clamav-scanner.adapter";
import type { SupabaseEvidenceStorageAdapter } from "../infrastructure/supabase-evidence-storage.adapter";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  MailService,
  RequiredMailDeliveryError,
} from "../../mail/mail.service";

type Rpc = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
};
type Query = {
  eq(column: string, value: string): Query;
  limit(value: number): Promise<{ data: unknown }>;
};
type UntypedClient = {
  from(table: string): { select(columns: string): Query };
};

/** Fair, bounded scanner. A provider outage is recorded as a retryable pending
 * job; it can never accidentally promote an unscanned version to clean. */
export class EvidenceScanWorker {
  private readonly instanceWorkerId: string;
  constructor(
    private readonly dependencies: Readonly<{
      supabase: SupabaseService;
      storage: SupabaseEvidenceStorageAdapter;
      scanner: ClamAvScannerAdapter;
      mail: MailService;
      workerId?: string;
      leaseSeconds: number;
    }>,
  ) {
    this.instanceWorkerId = dependencies.workerId ?? randomUUID();
  }

  async runOnce(): Promise<number> {
    const scanned = await this.runCycle();
    return scanned + (await this.deliverNotifications());
  }

  private async runCycle(): Promise<number> {
    const client =
      this.dependencies.supabase.admin() as unknown as UntypedClient & Rpc;
    const organizations = await client
      .from("evidence_document_scan_jobs")
      .select("organization_id")
      .eq("status", "queued")
      .limit(32);
    const ids = uniqueOrganizationIds(organizations.data);
    let processed = 0;
    for (const organizationId of ids) {
      const claim = await client.rpc("claim_evidence_scan_job_atomic", {
        p_organization_id: organizationId,
        p_worker_id: this.instanceWorkerId,
        p_lease_seconds: this.dependencies.leaseSeconds,
      });
      const job = object(claim.data);
      if (!job) continue;
      const versionId = string(job.versionId);
      if (!versionId) continue;
      const versions = await client
        .from("evidence_document_versions")
        .select("object_key,original_sha256,actual_size_bytes")
        .eq("organization_id", organizationId)
        .eq("id", versionId)
        .limit(1);
      const version = Array.isArray(versions.data)
        ? object(versions.data[0])
        : null;
      const key = version && string(version.object_key);
      const sha = version && string(version.original_sha256);
      const size = version && number(version.actual_size_bytes);
      if (!key || !sha || !size) {
        await complete(
          client,
          organizationId,
          this.instanceWorkerId,
          versionId,
          "unavailable",
          null,
        );
        continue;
      }
      const stream = await this.dependencies.storage.openVerified({
        objectKey: key,
        sha256: sha,
        byteSize: size,
      });
      if (!stream) {
        await complete(
          client,
          organizationId,
          this.instanceWorkerId,
          versionId,
          "unavailable",
          null,
        );
        continue;
      }
      const result = await this.dependencies.scanner.scan(stream);
      await complete(
        client,
        organizationId,
        this.instanceWorkerId,
        versionId,
        result.outcome === "infected" ? "detected" : result.outcome,
        result.outcome === "infected" ? result.detection : null,
      );
      processed++;
    }
    return processed;
  }

  private async deliverNotifications(): Promise<number> {
    const client =
      this.dependencies.supabase.admin() as unknown as UntypedClient & Rpc;
    const organizations = await client
      .from("evidence_document_notification_outbox")
      .select("organization_id")
      .eq("status", "queued")
      .limit(32);
    let delivered = 0;
    for (const organizationId of uniqueOrganizationIds(organizations.data)) {
      const result = await client.rpc(
        "claim_evidence_document_notification_atomic",
        {
          p_organization_id: organizationId,
          p_worker_id: this.workerId(),
          p_lease_seconds: this.dependencies.leaseSeconds,
        },
      );
      const notification = object(result.data);
      const outboxId = notification && string(notification.outboxId);
      const email = notification && string(notification.email);
      const eventType = notification && string(notification.eventType);
      if (!outboxId || !email) continue;
      try {
        if (eventType === "evidence_integrity_failure") {
          await this.dependencies.mail.sendEvidenceIntegrityFailureAlert(
            email,
            outboxId,
          );
        } else {
          await this.dependencies.mail.sendEvidenceQuarantinedAlert(
            email,
            outboxId,
          );
        }
        await client.rpc("complete_evidence_document_notification_atomic", {
          p_organization_id: organizationId,
          p_worker_id: this.workerId(),
          p_outbox_id: outboxId,
          p_outcome: "sent",
          p_error: null,
        });
        delivered++;
      } catch (error) {
        const unavailable = error instanceof RequiredMailDeliveryError;
        await client.rpc("complete_evidence_document_notification_atomic", {
          p_organization_id: organizationId,
          p_worker_id: this.workerId(),
          p_outbox_id: outboxId,
          p_outcome: "retry",
          p_error: unavailable
            ? "notification delivery unavailable"
            : "notification delivery failed",
        });
      }
    }
    return delivered;
  }

  private workerId(): string {
    return this.instanceWorkerId;
  }
}

async function complete(
  client: Rpc,
  organizationId: string,
  workerId: string,
  versionId: string,
  outcome: "clean" | "detected" | "unavailable",
  detection: string | null,
) {
  await client.rpc("complete_evidence_scan_job_atomic", {
    p_organization_id: organizationId,
    p_worker_id: workerId,
    p_version_id: versionId,
    p_engine_name: "clamav",
    p_engine_version: null,
    p_signature_version: null,
    p_outcome: outcome,
    p_detection: detection,
    p_retry_after_seconds: 300,
    p_error: outcome === "unavailable" ? "scanner unavailable" : null,
  });
}
function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function string(value: unknown) {
  return typeof value === "string" ? value : null;
}
function number(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}
function uniqueOrganizationIds(value: unknown) {
  return Array.from(
    new Set(
      Array.isArray(value)
        ? value
            .map((row) => object(row))
            .map((row) => row && string(row.organization_id))
            .filter((id): id is string => id !== null)
        : [],
    ),
  );
}
