import type {
  AuditExportFormat,
  AuditExportManifest,
  AuditSearchFilters,
} from "@repo/contracts/audit/types";

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type AuditExportFailureCode =
  | "access_changed"
  | "integrity_break"
  | "export_limit"
  | "storage_unavailable"
  | "generation_failed"
  | "snapshot_expired";

export type AuditExportJob = Readonly<{
  id: string;
  organizationId: string;
  actorUserId: string;
  leaseOwner: string;
  checkpointVersion: number;
  format: AuditExportFormat;
  filters: AuditSearchFilters;
  scopeDigest: string;
  selectedIds: readonly string[];
}>;

export type AuditExportEvent = Readonly<{
  id: string;
  sequence: string | null;
  previousHash: string | null;
  contentHash: string | null;
  canonicalContent: string | null;
  recomputedCanonicalContent: string | null;
  canonicalDisclosable: boolean;
  legacy: boolean;
  createdAt: string;
  actorId: string | null;
  actorType: string;
  actorLabel: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  correlationId: string | null;
  outcome: string | null;
  before: JsonValue;
  after: JsonValue;
  reason: string | null;
}>;

export type AuditExportArtifact = Readonly<{
  objectPath: string;
  sha256: string;
  byteSize: number;
  contentType: "application/zip";
  manifest: AuditExportManifest;
}>;

export type AuditExportJobRepository = Readonly<{
  claim(workerId: string): Promise<AuditExportJob | null>;
  events(
    job: AuditExportJob,
    offset: number,
    limit: number,
  ): Promise<readonly AuditExportEvent[]>;
  heartbeat(job: AuditExportJob): Promise<AuditExportJob>;
  complete(
    command: Readonly<{
      job: AuditExportJob;
      selectedIds: readonly string[];
      artifact: AuditExportArtifact;
    }>,
  ): Promise<"completed" | "conflict" | "not_found" | "invalid_state">;
  fail(
    command: Readonly<{
      job: AuditExportJob;
      code: AuditExportFailureCode;
      retryable: boolean;
    }>,
  ): Promise<void>;
}>;

export type AuditExportStorage = Readonly<{
  upload(
    input: Readonly<{
      objectPath: string;
      contentType: "application/zip";
      stream: NodeJS.ReadableStream;
    }>,
  ): Promise<
    Readonly<{ outcome: "stored" | "already_exists" | "unavailable" }>
  >;
  verify(
    input: Readonly<{ objectPath: string; sha256: string; byteSize: number }>,
  ): Promise<
    Readonly<{ outcome: "verified" | "missing" | "corrupt" | "unavailable" }>
  >;
}>;
