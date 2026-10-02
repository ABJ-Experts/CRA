import { createHash, randomUUID } from "node:crypto";
import type { EvidenceStoragePort } from "./evidence-intake-use-cases";

export const EVIDENCE_BULK_INTAKE_REPOSITORY = Symbol(
  "EVIDENCE_BULK_INTAKE_REPOSITORY",
);

export type BulkEvidenceClass =
  | "risk_assessment"
  | "test_report"
  | "policy"
  | "procedure"
  | "supplier_attestation"
  | "certificate"
  | "architecture_document"
  | "other";

export type BulkIntakeItem = Readonly<{
  id: string;
  status:
    | "pending_review"
    | "uploading"
    | "scan_pending"
    | "clean"
    | "quarantined"
    | "failed"
    | "cancelled";
  documentId: string | null;
  versionId: string | null;
}>;

export type BulkIntakeMutation = Readonly<{
  outcome:
    | "created"
    | "found"
    | "replayed"
    | "reserved"
    | "scan_pending"
    | "failed"
    | "cancelled"
    | "not_found"
    | "forbidden"
    | "conflict"
    | "idempotency_mismatch"
    | "invalid_request";
  value?: Record<string, unknown>;
}>;

/**
 * This port deliberately owns the durable batch-item state. The browser only
 * coordinates bounded transfers; it cannot promote, cancel, or replay a
 * version outside the same tenant-scoped database transaction.
 */
export interface EvidenceBulkIntakeRepository {
  createBatch(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      items: readonly BulkIntakeCreateItem[];
      idempotencyKey: string;
    }>,
  ): Promise<BulkIntakeMutation>;
  batch(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; batchId: string }>,
  ): Promise<BulkIntakeMutation>;
  initializeItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
      idempotencyKey: string;
      documentClass: BulkEvidenceClass;
      classificationDecision: "accepted" | "corrected";
      objectKey: string;
      uploadExpiresAt: string;
      requestDigest: string;
    }>,
  ): Promise<BulkIntakeMutation>;
  getUploadItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
    }>,
  ): Promise<Readonly<{
    objectKey: string;
    versionId: string;
    declaredByteSize: number;
  }> | null>;
  completeItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
      versionId: string;
      idempotencyKey: string;
      sha256: string | null;
      byteSize: number | null;
      mediaType: string | null;
      failureCode: string | null;
      requestDigest: string;
    }>,
  ): Promise<BulkIntakeMutation>;
  retryItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
      idempotencyKey: string;
      documentClass: BulkEvidenceClass;
      classificationDecision: "accepted" | "corrected";
      fileName: string;
      declaredByteSize: number;
      objectKey: string;
      uploadExpiresAt: string;
      requestDigest: string;
    }>,
  ): Promise<BulkIntakeMutation>;
  cancelItem(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      batchId: string;
      itemId: string;
      idempotencyKey: string;
    }>,
  ): Promise<BulkIntakeMutation>;
}

export type BulkIntakeCreateItem = Readonly<{
  clientItemId: string;
  fileName: string;
  byteSize: number;
  title: string;
  ownerUserId: string;
  productIds: readonly string[];
  validFrom: string | null;
  validUntil: string | null;
  idempotencyKey: string;
}>;

type BulkCommand = Readonly<{
  organizationId: string;
  actorId: string;
  productId: string;
  batchId: string;
  itemId: string;
  idempotencyKey: string;
}>;

type InitializeCommand = BulkCommand &
  Readonly<{
    documentClass: BulkEvidenceClass;
    classificationDecision: "accepted" | "corrected";
  }>;

type RetryCommand = InitializeCommand &
  Readonly<{ fileName: string; byteSize: number }>;

export class EvidenceBulkIntakeUseCases {
  constructor(
    private readonly repository: EvidenceBulkIntakeRepository,
    private readonly storage: EvidenceStoragePort,
  ) {}

  create(
    input: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      items: readonly BulkIntakeCreateItem[];
      idempotencyKey: string;
    }>,
  ): Promise<BulkIntakeMutation> {
    return this.repository.createBatch(input.organizationId, {
      actorId: input.actorId,
      productId: input.productId,
      items: input.items,
      idempotencyKey: input.idempotencyKey,
    });
  }

  get(input: Omit<BulkCommand, "itemId" | "idempotencyKey">) {
    return this.repository.batch(input.organizationId, {
      actorId: input.actorId,
      productId: input.productId,
      batchId: input.batchId,
    });
  }

  async initialize(input: InitializeCommand) {
    // Preserve the adapter's opaque UUID/UUID/UUID/UUID key convention; batch
    // metadata must not be exposed through private object paths.
    const objectKey = `${input.organizationId}/${randomUUID()}/${randomUUID()}/${randomUUID()}`;
    const uploadExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const reserved = await this.repository.initializeItem(
      input.organizationId,
      {
        actorId: input.actorId,
        productId: input.productId,
        batchId: input.batchId,
        itemId: input.itemId,
        idempotencyKey: input.idempotencyKey,
        documentClass: input.documentClass,
        classificationDecision: input.classificationDecision,
        objectKey,
        uploadExpiresAt,
        requestDigest: digest({
          batchId: input.batchId,
          itemId: input.itemId,
          idempotencyKey: input.idempotencyKey,
          documentClass: input.documentClass,
          classificationDecision: input.classificationDecision,
        }),
      },
    );
    if (reserved.outcome !== "reserved" && reserved.outcome !== "replayed")
      return reserved;
    const value = reserved.value ?? {};
    const key = stringValue(value.objectKey);
    const byteSize = numberValue(value.declaredByteSize);
    if (!key || byteSize === null) return { outcome: "conflict" as const };
    const upload = await this.storage.createSignedUpload({
      objectKey: key,
      contentType: "application/octet-stream",
      byteSize,
    });
    return Object.freeze({ ...reserved, value: { ...value, upload } });
  }

  async complete(input: BulkCommand) {
    const source = await this.repository.getUploadItem(input.organizationId, {
      actorId: input.actorId,
      productId: input.productId,
      batchId: input.batchId,
      itemId: input.itemId,
    });
    if (!source) return { outcome: "not_found" as const };
    const inspected = await this.storage.inspect({
      objectKey: source.objectKey,
      maximumByteSize: 50 * 1024 * 1024,
    });
    return this.repository.completeItem(input.organizationId, {
      actorId: input.actorId,
      productId: input.productId,
      batchId: input.batchId,
      itemId: input.itemId,
      versionId: source.versionId,
      idempotencyKey: input.idempotencyKey,
      sha256: inspected.outcome === "verified" ? inspected.sha256 : null,
      byteSize: inspected.outcome === "verified" ? inspected.byteSize : null,
      mediaType: inspected.outcome === "verified" ? inspected.mediaType : null,
      failureCode: inspected.outcome === "verified" ? null : inspected.code,
      requestDigest: digest({
        batchId: input.batchId,
        itemId: input.itemId,
        versionId: source.versionId,
        idempotencyKey: input.idempotencyKey,
      }),
    });
  }

  cancel(input: BulkCommand) {
    return this.repository.cancelItem(input.organizationId, {
      actorId: input.actorId,
      productId: input.productId,
      batchId: input.batchId,
      itemId: input.itemId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async retry(input: RetryCommand) {
    const objectKey = `${input.organizationId}/${randomUUID()}/${randomUUID()}/${randomUUID()}`;
    const uploadExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const reserved = await this.repository.retryItem(input.organizationId, {
      actorId: input.actorId,
      productId: input.productId,
      batchId: input.batchId,
      itemId: input.itemId,
      idempotencyKey: input.idempotencyKey,
      documentClass: input.documentClass,
      classificationDecision: input.classificationDecision,
      fileName: input.fileName,
      declaredByteSize: input.byteSize,
      objectKey,
      uploadExpiresAt,
      requestDigest: digest({
        batchId: input.batchId,
        itemId: input.itemId,
        idempotencyKey: input.idempotencyKey,
        documentClass: input.documentClass,
        classificationDecision: input.classificationDecision,
        fileName: input.fileName,
        byteSize: input.byteSize,
      }),
    });
    if (reserved.outcome !== "reserved" && reserved.outcome !== "replayed")
      return reserved;
    const value = reserved.value ?? {};
    const key = stringValue(value.objectKey);
    const byteSize = numberValue(value.declaredByteSize);
    if (!key || byteSize === null) return { outcome: "conflict" as const };
    const upload = await this.storage.createSignedUpload({
      objectKey: key,
      contentType: "application/octet-stream",
      byteSize,
    });
    return Object.freeze({ ...reserved, value: { ...value, upload } });
  }
}

function digest(value: unknown): string {
  // The database owns the authoritative request-digest comparison. Keeping this
  // stable and non-secret makes repeated browser requests deterministic.
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
