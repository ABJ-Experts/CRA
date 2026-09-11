import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  reportingStageDraftApprovalSchema,
  reportingStageDraftResponseSchema,
  reportingEvidenceTimelineEventSchema,
  reportingStageExternalFilingSchema,
  reportingStageAcknowledgementResponseSchema,
  type CreateReportingStageAcknowledgementInput,
  type GenerateReportingObligationEvidencePackInput,
  type GenerateReportingStageSubmissionPackageInput,
  type RecordReportingStageExternalFilingFields,
  type ReportingObligationEvidencePackDownloadResponse,
  type ReportingObligationEvidencePackResponse,
  type ReportingStageAcknowledgementResponse,
  type ReportingStageEvidencePackageDownloadResponse,
  type ReportingStageEvidencePackageResponse,
  type ReportingStageEvidenceTimelineResponse,
  type ReportingStageExternalFilingResponse,
} from "@repo/contracts/reporting";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import { buildStoredZip } from "../../organizations/tenant-administration/worker/export-archive";
import type {
  ReportingEvidenceWorkflowPort,
  ReportingStageReceiptUpload,
} from "../application/reporting-obligation.port";
import {
  ReportingEvidenceSigner,
  ReportingEvidenceSigningError,
} from "./reporting-evidence-signer";

const bucket = "reporting-evidence";
const maximumBytes = 25 * 1024 * 1024;
const receiptMaximumBytes = 10 * 1024 * 1024;
const downloadTtlSeconds = 300;

type RpcClient = Readonly<{
  rpc(
    name: string,
    args?: Readonly<Record<string, unknown>>,
  ): Promise<
    Readonly<{ data: unknown; error: Readonly<{ message?: string }> | null }>
  >;
  storage: {
    from(bucketName: string): {
      upload(
        path: string,
        body: Buffer,
        options: Readonly<{ contentType: string; upsert: boolean }>,
      ): Promise<Readonly<{ error: Readonly<{ message?: string }> | null }>>;
      createSignedUrl(
        path: string,
        expiresIn: number,
        options: Readonly<{ download: string }>,
      ): Promise<
        Readonly<{
          data: Readonly<{ signedUrl: string }> | null;
          error: Readonly<{ message?: string }> | null;
        }>
      >;
    };
  };
}>;

/**
 * A focused infrastructure boundary for immutable reporting evidence. It owns
 * object-storage keys and signing configuration, while authorization and
 * request parsing remain above it.
 */
@Injectable()
export class ReportingEvidenceWorkflowService implements ReportingEvidenceWorkflowPort {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async generateStageSubmissionPackage(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
        stageId: string;
      } & GenerateReportingStageSubmissionPackageInput
    >,
  ): Promise<ReportingStageEvidencePackageResponse | null> {
    const reservation = await this.rpc(
      "reserve_reporting_stage_package_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_obligation_id: input.obligationId,
        p_stage_id: input.stageId,
        p_approval_id: input.approvalId,
        p_draft_revision: input.draftRevision,
        p_draft_hash: input.draftHash,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: null,
      },
    );
    if (reservation.outcome === "not_found") return null;
    if (!["created", "idempotent"].includes(reservation.outcome)) {
      throw new ReportingEvidenceWorkflowError("conflict");
    }
    const packageReservation = reservedPackageSchema.parse(
      reservation.result,
    ).package;
    const draftResult = await this.rpc("get_reporting_stage_draft", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_stage_id: input.stageId,
    });
    if (draftResult.outcome === "not_found") return null;
    const draft = reportingStageDraftResponseSchema.parse(
      draftResult.result,
    ).draft;
    if (
      draft.obligationId !== input.obligationId ||
      draft.revision !== input.draftRevision ||
      draft.contentHash !== input.draftHash
    ) {
      throw new ReportingEvidenceWorkflowError("conflict");
    }

    const signer = this.signer();
    const snapshot = stableJson({
      version: 1,
      approvalId: input.approvalId,
      organizationId,
      obligationId: input.obligationId,
      stageId: input.stageId,
      draft,
    });
    const snapshotBytes = Buffer.from(snapshot, "utf8");
    const manifest = stableJson({
      version: 1,
      algorithm: "Ed25519",
      keyId: signer.keyId,
      approvalId: input.approvalId,
      draftRevision: input.draftRevision,
      draftHash: input.draftHash,
      files: [
        {
          path: "approved-stage-snapshot.json",
          byteLength: snapshotBytes.byteLength,
          sha256: digest(snapshotBytes),
        },
      ],
    });
    const manifestBytes = Buffer.from(manifest, "utf8");
    const signature = signer.sign(manifestBytes);
    const signatureText = signature.signature.toString("base64url");
    const archive = buildStoredZip([
      { path: "approved-stage-snapshot.json", bytes: snapshotBytes },
      { path: "manifest.json", bytes: manifestBytes },
      { path: "manifest.sig", bytes: Buffer.from(signatureText, "ascii") },
    ]);
    if (archive.bytes.byteLength > maximumBytes) {
      throw new ReportingEvidenceWorkflowError("invalid_request");
    }
    const upload = await this.client()
      .storage.from(bucket)
      .upload(packageReservation.objectPath, archive.bytes, {
        contentType: "application/zip",
        upsert: false,
      });
    if (upload.error && !alreadyExists(upload.error.message)) {
      throw new ReportingEvidenceWorkflowError("unavailable");
    }
    const finalized = await this.rpc(
      "finalize_reporting_stage_package_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_package_id: packageReservation.id,
        p_sha256: archive.sha256,
        p_byte_size: archive.bytes.byteLength,
        p_key_id: signature.keyId,
        p_signature: signatureText,
        p_manifest_sha256: digest(manifestBytes),
        p_object_path: packageReservation.objectPath,
        // Reservation and finalization are separate durable commands. Reusing
        // the browser command key would be rejected by the command ledger.
        p_idempotency_key: internalCommandKey(
          "finalize-stage-package",
          packageReservation.id,
        ),
        p_correlation_id: null,
      },
    );
    if (!["updated", "idempotent"].includes(finalized.outcome)) {
      throw new ReportingEvidenceWorkflowError(
        finalized.outcome === "conflict" ? "conflict" : "unavailable",
      );
    }
    const now = utcSecond(new Date());
    return {
      package: {
        id: packageReservation.id,
        organizationId,
        obligationId: input.obligationId,
        stageId: input.stageId,
        approvalId: input.approvalId,
        draftRevision: input.draftRevision,
        draftHash: input.draftHash,
        status: "ready",
        fileName: packageFileName(input.stageId),
        byteLength: archive.bytes.byteLength,
        sha256: archive.sha256,
        manifestSha256: digest(manifestBytes),
        signature: {
          algorithm: "Ed25519",
          keyId: signature.keyId,
          detachedSignature: signatureText,
          publicKeyFingerprint: signature.publicKeyFingerprint,
        },
        createdAt: now,
        completedAt: now,
        failureCode: null,
      },
    };
  }

  async getStageSubmissionPackageDownload(
    organizationId: string,
    input: Readonly<{ actorId: string; stageId: string; packageId: string }>,
  ): Promise<ReportingStageEvidencePackageDownloadResponse | null> {
    const packageData = await this.packageById(
      organizationId,
      input.actorId,
      input.stageId,
      input.packageId,
    );
    if (packageData === null || packageData.state !== "available") return null;
    const fileName = packageFileName(packageData.stageId);
    const response = await this.client()
      .storage.from(bucket)
      .createSignedUrl(packageData.objectPath, downloadTtlSeconds, {
        download: fileName,
      });
    if (response.error || !response.data) {
      throw new ReportingEvidenceWorkflowError("unavailable");
    }
    return {
      download: {
        fileName,
        downloadUrl: response.data.signedUrl,
        expiresAt: new Date(Date.now() + downloadTtlSeconds * 1000)
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z"),
        sha256: packageData.sha256,
        byteLength: packageData.byteLength,
      },
    };
  }

  async createStageFilingProof(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      sessionId: string;
      obligationId: string;
      stageId: string;
      packageId: string;
      idempotencyKey: string;
      expiresAt: string;
    }>,
  ) {
    const packageData = await this.packageById(
      organizationId,
      input.actorId,
      input.stageId,
      input.packageId,
    );
    if (
      packageData === null ||
      packageData.obligationId !== input.obligationId ||
      packageData.stageId !== input.stageId ||
      packageData.state !== "available"
    )
      return null;
    const proof = await this.rpc("create_reporting_stage_filing_proof_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_session_id: input.sessionId,
      p_package_id: input.packageId,
      p_approval_id: packageData.approvalId,
      p_action_digest: digest(
        Buffer.from(
          stableJson({
            packageId: input.packageId,
            idempotencyKey: input.idempotencyKey,
          }),
        ),
      ),
      p_expires_at: input.expiresAt,
      p_correlation_id: null,
    });
    if (proof.outcome === "not_found") return null;
    if (proof.outcome !== "created")
      throw new ReportingEvidenceWorkflowError("conflict");
    return filingProofSchema.parse(proof.result);
  }

  async recordStageExternalFiling(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      sessionId: string;
      obligationId: string;
      stageId: string;
      fields: RecordReportingStageExternalFilingFields;
      receipt: ReportingStageReceiptUpload;
    }>,
  ): Promise<ReportingStageExternalFilingResponse | null> {
    if (
      input.receipt.bytes.byteLength < 1 ||
      input.receipt.bytes.byteLength > receiptMaximumBytes
    ) {
      throw new ReportingEvidenceWorkflowError("invalid_request");
    }
    const packageData = await this.packageById(
      organizationId,
      input.actorId,
      input.stageId,
      input.fields.packageId,
    );
    if (
      packageData === null ||
      packageData.obligationId !== input.obligationId ||
      packageData.stageId !== input.stageId ||
      packageData.state !== "available"
    )
      return null;
    const extension = extensionFor(input.receipt.mimeType);
    const proofPath = `${organizationId}/${input.stageId}/filings/${input.fields.idempotencyKey}/receipt.${extension}`;
    const receiptDigest = digest(input.receipt.bytes);
    const upload = await this.client()
      .storage.from(bucket)
      .upload(proofPath, input.receipt.bytes, {
        contentType: input.receipt.mimeType,
        upsert: false,
      });
    if (upload.error && !alreadyExists(upload.error.message)) {
      throw new ReportingEvidenceWorkflowError("unavailable");
    }
    const result = await this.rpc("record_reporting_stage_filing_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_session_id: input.sessionId,
      p_obligation_id: input.obligationId,
      p_stage_id: input.stageId,
      p_package_id: input.fields.packageId,
      p_approval_id: packageData.approvalId,
      p_proof_id: input.fields.filingReauthenticationProofId,
      p_submitted_at: input.fields.submittedAt,
      p_basis: input.fields.submittedAtBasis,
      p_reference: input.fields.submissionReference,
      p_proof_object_path: proofPath,
      p_proof_sha256: receiptDigest,
      p_proof_size: input.receipt.bytes.byteLength,
      p_proof_mime: input.receipt.mimeType,
      p_proof_filename: input.receipt.fileName,
      p_idempotency_key: input.fields.idempotencyKey,
      p_correlation_id: null,
    });
    if (result.outcome === "not_found") return null;
    if (!["updated", "idempotent"].includes(result.outcome)) {
      throw new ReportingEvidenceWorkflowError("conflict");
    }
    const evidence = await this.stageEvidence(
      organizationId,
      input.actorId,
      input.stageId,
    );
    const filing = evidence.submission;
    if (!filing) throw new ReportingEvidenceWorkflowError("unavailable");
    return { filing };
  }

  async appendStageAcknowledgement(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & CreateReportingStageAcknowledgementInput
    >,
  ): Promise<ReportingStageAcknowledgementResponse | null> {
    const result = await this.rpc(
      "append_reporting_stage_acknowledgement_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_submission_id: input.submissionId,
        p_acknowledged_at: input.acknowledgedAt,
        p_reference: input.acknowledgementReference,
        p_notes: input.acknowledgementBasis,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: null,
      },
    );
    if (result.outcome === "not_found") return null;
    if (!["created", "idempotent"].includes(result.outcome))
      throw new ReportingEvidenceWorkflowError("conflict");
    const acknowledgement = await this.rpc(
      "get_reporting_submission_acknowledgement_api",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_submission_id: input.submissionId,
      },
    );
    if (acknowledgement.outcome === "not_found") return null;
    if (acknowledgement.outcome !== "found")
      throw new ReportingEvidenceWorkflowError("unavailable");
    return reportingStageAcknowledgementResponseSchema.parse(
      acknowledgement.result,
    );
  }

  async stageEvidenceTimeline(
    organizationId: string,
    input: Readonly<{ actorId: string; obligationId: string; stageId: string }>,
  ): Promise<ReportingStageEvidenceTimelineResponse | null> {
    const evidence = await this.stageEvidence(
      organizationId,
      input.actorId,
      input.stageId,
    );
    if (evidence.obligationId !== input.obligationId) return null;
    return { events: evidence.timeline };
  }

  async generateObligationEvidencePack(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        obligationId: string;
      } & GenerateReportingObligationEvidencePackInput
    >,
  ): Promise<ReportingObligationEvidencePackResponse | null> {
    const reserved = await this.rpc("reserve_reporting_obligation_evidence_pack_atomic", {
      p_organization_id: organizationId, p_actor_user_id: input.actorId,
      p_obligation_id: input.obligationId, p_idempotency_key: input.idempotencyKey,
      p_correlation_id: null,
    });
    if (reserved.outcome === "not_found") return null;
    if (!['created', 'idempotent'].includes(reserved.outcome)) throw new ReportingEvidenceWorkflowError("conflict");
    const reservation = reservedEvidencePackSchema.parse(reserved.result).evidencePack;
    const obligation = await this.rpc("get_reporting_obligation", {
      p_organization_id: organizationId, p_actor_user_id: input.actorId,
      p_obligation_id: input.obligationId,
    });
    if (obligation.outcome !== "found") return null;
    const records = Buffer.from(stableJson({ version: 1, obligation: obligation.result }), "utf8");
    const manifestBytes = Buffer.from(stableJson({ version: 1, files: [{ path: "reporting-evidence.json", sha256: digest(records), byteLength: records.byteLength }] }), "utf8");
    const archive = buildStoredZip([
      { path: "reporting-evidence.json", bytes: records },
      { path: "manifest.json", bytes: manifestBytes },
    ]);
    if (archive.bytes.byteLength > maximumBytes) throw new ReportingEvidenceWorkflowError("invalid_request");
    const upload = await this.client().storage.from(bucket).upload(reservation.objectPath, archive.bytes, { contentType: "application/zip", upsert: false });
    if (upload.error && !alreadyExists(upload.error.message)) {
      throw new ReportingEvidenceWorkflowError("unavailable");
    }
    const finalized = await this.rpc("finalize_reporting_obligation_evidence_pack_atomic", {
      p_organization_id: organizationId, p_actor_user_id: input.actorId, p_pack_id: reservation.id,
      p_sha256: archive.sha256, p_byte_size: archive.bytes.byteLength, p_manifest_sha256: digest(manifestBytes),
      p_object_path: reservation.objectPath,
      p_idempotency_key: internalCommandKey("finalize-evidence-pack", reservation.id),
      p_correlation_id: null,
    });
    if (!['updated', 'idempotent'].includes(finalized.outcome)) throw new ReportingEvidenceWorkflowError("conflict");
    return { evidencePack: { id: reservation.id, organizationId, obligationId: input.obligationId,
      fileName: `reporting-evidence-${input.obligationId}.zip`, sha256: archive.sha256,
      manifestSha256: digest(manifestBytes), byteLength: archive.bytes.byteLength,
      createdAt: utcSecond(new Date()) } };
  }

  async getObligationEvidencePackDownload(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      obligationId: string;
      evidencePackId: string;
    }>,
  ): Promise<ReportingObligationEvidencePackDownloadResponse | null> {
    const result = await this.rpc("get_reporting_obligation_evidence_pack_api", {
      p_organization_id: organizationId, p_actor_user_id: input.actorId,
      p_obligation_id: input.obligationId, p_evidence_pack_id: input.evidencePackId,
    });
    if (result.outcome === "not_found") return null;
    if (result.outcome !== "found") throw new ReportingEvidenceWorkflowError("unavailable");
    const pack = evidencePackReadSchema.parse(result.result).evidencePack;
    if (pack.state !== "available") return null;
    const fileName = `reporting-evidence-${input.obligationId}.zip`;
    const signed = await this.client().storage.from(bucket).createSignedUrl(pack.objectPath, downloadTtlSeconds, { download: fileName });
    if (signed.error || !signed.data) throw new ReportingEvidenceWorkflowError("unavailable");
    return { download: { fileName, downloadUrl: signed.data.signedUrl,
      expiresAt: utcSecond(new Date(Date.now() + downloadTtlSeconds * 1000)),
      sha256: pack.sha256, byteLength: pack.byteLength } };
  }

  private signer(): ReportingEvidenceSigner {
    const keyId = this.config.get<string>("REPORTING_EVIDENCE_SIGNING_KEY_ID");
    const privateKey = this.config.get<string>(
      "REPORTING_EVIDENCE_SIGNING_PRIVATE_KEY",
    );
    const publicKey = this.config.get<string>(
      "REPORTING_EVIDENCE_SIGNING_PUBLIC_KEY",
    );
    if (!keyId || !privateKey || !publicKey)
      throw new ReportingEvidenceWorkflowError("unavailable");
    try {
      return new ReportingEvidenceSigner({ keyId, privateKey, publicKey });
    } catch (error) {
      if (error instanceof ReportingEvidenceSigningError)
        throw new ReportingEvidenceWorkflowError("unavailable");
      throw error;
    }
  }

  private async packageById(
    organizationId: string,
    actorId: string,
    stageId: string,
    packageId: string,
  ) {
    const result = await this.rpc("get_reporting_stage_evidence_api", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_stage_id: stageId,
    });
    if (result.outcome === "not_found") return null;
    const packages = evidenceReadSchema.parse(result.result).packages;
    return packages.find((entry) => entry.id === packageId) ?? null;
  }

  private async stageEvidence(
    organizationId: string,
    actorId: string,
    stageId: string,
  ) {
    const result = await this.rpc("get_reporting_stage_evidence_api", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_stage_id: stageId,
    });
    if (result.outcome !== "found")
      throw new ReportingEvidenceWorkflowError("unavailable");
    return evidenceReadSchema.parse(result.result);
  }

  private async rpc(name: string, args: Readonly<Record<string, unknown>>) {
    const response = await this.client().rpc(name, args);
    if (response.error) throw new ReportingEvidenceWorkflowError("unavailable");
    const row = Array.isArray(response.data) ? response.data[0] : null;
    const parsed = rpcResultSchema.safeParse(row);
    if (!parsed.success)
      throw new ReportingEvidenceWorkflowError("unavailable");
    return parsed.data;
  }

  private client(): RpcClient {
    return this.supabase.admin() as unknown as RpcClient;
  }
}

export class ReportingEvidenceWorkflowError extends Error {
  constructor(readonly code: "conflict" | "invalid_request" | "unavailable") {
    super(code);
  }
}

const rpcResultSchema = z
  .object({ outcome: z.string(), result: z.unknown().nullable() })
  .passthrough();
const reservedPackageSchema = z
  .object({
    package: z
      .object({
        id: z.uuid(),
        state: z.literal("reserved"),
        objectPath: z.string(),
      })
      .strict(),
  })
  .strict();
const reservedEvidencePackSchema = z.object({
  evidencePack: z.object({ id: z.uuid(), state: z.literal("reserved"), objectPath: z.string() }).strict(),
}).strict();
const evidencePackReadSchema = z.object({
  evidencePack: z.object({
    id: z.uuid(), state: z.string(), objectPath: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive(),
  }).passthrough(),
}).strict();
const filingProofSchema = z
  .object({ reauthenticationProofId: z.uuid(), expiresAt: z.string() })
  .strict();
const evidenceReadSchema = z
  .object({
    obligationId: z.uuid(),
    approval: reportingStageDraftApprovalSchema.nullable(),
    packages: z.array(
      z
        .object({
          id: z.uuid(),
          obligationId: z.uuid(),
          stageId: z.uuid(),
          approvalId: z.uuid(),
          state: z.string(),
          objectPath: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          byteLength: z.number().int().positive(),
        })
        .passthrough(),
    ),
    submission: z.unknown().nullable(),
    timeline: z.array(z.unknown()),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    submission: value.submission
      ? reportingStageExternalFilingSchema.parse({
          ...(value.submission as Record<string, unknown>),
          approval: value.approval,
        })
      : null,
    timeline: z
      .array(reportingEvidenceTimelineEventSchema)
      .parse(value.timeline),
  }));

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function utcSecond(value: Date): string {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  return value;
}
function packageFileName(stageId: string): string {
  return `manual-submission-${stageId}.zip`;
}
function extensionFor(
  mimeType: ReportingStageReceiptUpload["mimeType"],
): "pdf" | "png" | "jpg" | "txt" {
  const extensions: Record<
    ReportingStageReceiptUpload["mimeType"],
    "pdf" | "png" | "jpg" | "txt"
  > = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "text/plain": "txt",
  };
  return extensions[mimeType];
}
function alreadyExists(message?: string): boolean {
  return /exist|duplicate|409/i.test(message ?? "");
}

/** A deterministic, separate UUID for a durable internal workflow step. */
function internalCommandKey(purpose: string, resourceId: string): string {
  const hex = createHash("sha256")
    .update(`reporting-evidence:${purpose}:${resourceId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${
    (Number.parseInt(hex.slice(16, 18), 16) & 0x3f | 0x80)
      .toString(16)
      .padStart(2, "0")
  }${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}
