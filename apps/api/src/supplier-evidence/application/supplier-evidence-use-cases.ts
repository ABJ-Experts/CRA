import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  CloseSupplierEvidenceRequestInput,
  CreateSupplierEvidenceRequestInput,
  InitializeSupplierEvidencePortalUploadInput,
  IssueSupplierEvidenceRequestInput,
  MarkSupplierEvidenceInvitationDeliveryInput,
  PreviewSupplierEvidenceRequestInput,
  ReRequestSupplierEvidenceRequestInput,
  ReissueSupplierEvidenceRequestInput,
  ReviewSupplierEvidenceSubmissionInput,
  RevokeSupplierEvidenceRequestInput,
  ReviseSupplierEvidenceRequestInput,
  SupplierEvidencePortalSession,
  SupplierEvidenceInvitation,
  SupplierEvidenceRequestDetail,
  SupplierEvidenceReviewRequestDetail,
  SupplierEvidenceRequestListQuery,
} from "@repo/contracts/supplier-evidence";

export const SUPPLIER_EVIDENCE_REPOSITORY = Symbol(
  "SUPPLIER_EVIDENCE_REPOSITORY",
);

export class SupplierEvidenceConflictError extends Error {}
export class SupplierEvidenceForbiddenError extends Error {}
export class SupplierEvidenceInvalidRequestError extends Error {}
export class SupplierEvidenceUnavailableError extends Error {}

export interface SupplierEvidenceStoragePort {
  createSignedUpload(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
    }>,
  ): Promise<Readonly<{ uploadUrl: string; expiresAt: string }>>;
  inspect(
    input: Readonly<{ objectKey: string; maximumByteSize: number }>,
  ): Promise<
    | Readonly<{
        outcome: "verified";
        sha256: string;
        byteSize: number;
        mediaType: string;
      }>
    | Readonly<{
        outcome: "missing" | "unavailable" | "rejected";
        code: string;
      }>
  >;
}

export interface SupplierEvidenceRepository {
  preview(
    organizationId: string,
    input: Readonly<{ actorId: string } & PreviewSupplierEvidenceRequestInput>,
  ): Promise<unknown>;
  create(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateSupplierEvidenceRequestInput>,
  ): Promise<SupplierEvidenceRequestDetail>;
  revise(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & ReviseSupplierEvidenceRequestInput
    >,
  ): Promise<SupplierEvidenceRequestDetail>;
  issue(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & IssueSupplierEvidenceRequestInput & {
          tokenHash: string;
          expiresAt: string;
        }
    >,
  ): Promise<
    Readonly<{
      outcome: "issued" | "reissued" | "replayed";
      request: SupplierEvidenceRequestDetail;
      invitation: SupplierEvidenceInvitation;
      recipientEmail: string;
    }>
  >;
  reissue(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & ReissueSupplierEvidenceRequestInput & {
          tokenHash: string;
          expiresAt: string;
        }
    >,
  ): Promise<
    Readonly<{
      outcome: "issued" | "reissued" | "replayed";
      request: SupplierEvidenceRequestDetail;
      invitation: SupplierEvidenceInvitation;
      recipientEmail: string;
    }>
  >;
  review(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
        submissionId: string;
      } & ReviewSupplierEvidenceSubmissionInput
    >,
  ): Promise<SupplierEvidenceReviewRequestDetail>;
  reRequest(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & ReRequestSupplierEvidenceRequestInput & {
          tokenHash: string;
          expiresAt: string;
        }
    >,
  ): Promise<
    Readonly<{
      outcome: "re_requested" | "replayed";
      request: SupplierEvidenceRequestDetail;
      invitation: SupplierEvidenceInvitation;
      recipientEmail: string;
    }>
  >;
  markInvitationDelivery(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
        invitationId: string;
      } & MarkSupplierEvidenceInvitationDeliveryInput
    >,
  ): Promise<SupplierEvidenceRequestDetail>;
  revoke(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & RevokeSupplierEvidenceRequestInput
    >,
  ): Promise<SupplierEvidenceRequestDetail>;
  close(
    organizationId: string,
    input: Readonly<
      { actorId: string; requestId: string } & CloseSupplierEvidenceRequestInput
    >,
  ): Promise<SupplierEvidenceRequestDetail>;
  list(
    organizationId: string,
    input: Readonly<{ actorId: string } & SupplierEvidenceRequestListQuery>,
  ): Promise<unknown>;
  detail(
    organizationId: string,
    input: Readonly<{ actorId: string; requestId: string }>,
  ): Promise<SupplierEvidenceRequestDetail | null>;
  reviewDetail(
    organizationId: string,
    input: Readonly<{ actorId: string; requestId: string }>,
  ): Promise<SupplierEvidenceReviewRequestDetail | null>;
  redeem(
    input: Readonly<{
      invitationTokenHash: string;
      sessionTokenHash: string;
      sessionExpiresAt: string;
    }>,
  ): Promise<
    Readonly<{
      expiresAt: string;
      request: SupplierEvidencePortalSession["request"];
    }>
  >;
  portalRequest(
    input: Readonly<{ sessionTokenHash: string }>,
  ): Promise<unknown>;
  reserve(
    input: Readonly<{
      sessionTokenHash: string;
      checklistItemId: string;
      fileName: string;
      mediaType: string;
      sha256: string;
      byteSize: number;
      objectKey: string;
      uploadExpiresAt: string;
      idempotencyKey: string;
      requestDigest: string;
    }>,
  ): Promise<
    Readonly<{ submission: unknown; versionId: string; objectKey: string }>
  >;
  uploadForFinalization(
    input: Readonly<{ sessionTokenHash: string; versionId: string }>,
  ): Promise<Readonly<{ objectKey: string }>>;
  finalize(
    input: Readonly<{
      sessionTokenHash: string;
      versionId: string;
      actualByteSize: number | null;
      mediaType: string | null;
      sha256: string | null;
      idempotencyKey: string;
      requestDigest: string;
    }>,
  ): Promise<unknown>;
}

/** Orchestrates external bearer hashing and private object inspection only; SQL owns authorization and durable transitions. */
export class SupplierEvidenceUseCases {
  constructor(
    private readonly repository: SupplierEvidenceRepository,
    private readonly storage: SupplierEvidenceStoragePort,
  ) {}

  preview(
    organizationId: string,
    input: Readonly<{ actorId: string } & PreviewSupplierEvidenceRequestInput>,
  ) {
    return this.repository.preview(organizationId, input);
  }
  create(
    organizationId: string,
    input: Readonly<{ actorId: string } & CreateSupplierEvidenceRequestInput>,
  ) {
    return this.repository.create(organizationId, input);
  }
  revise(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & ReviseSupplierEvidenceRequestInput
    >,
  ) {
    return this.repository.revise(organizationId, input);
  }
  list(
    organizationId: string,
    input: Readonly<{ actorId: string } & SupplierEvidenceRequestListQuery>,
  ) {
    return this.repository.list(organizationId, input);
  }
  detail(
    organizationId: string,
    input: Readonly<{ actorId: string; requestId: string }>,
  ) {
    return this.repository.detail(organizationId, input);
  }
  reviewDetail(
    organizationId: string,
    input: Readonly<{ actorId: string; requestId: string }>,
  ) {
    return this.repository.reviewDetail(organizationId, input);
  }

  async issue(
    organizationId: string,
    input: Readonly<
      { actorId: string; requestId: string } & IssueSupplierEvidenceRequestInput
    >,
  ) {
    const invitationToken = secret();
    const issued = await this.repository.issue(organizationId, {
      ...input,
      tokenHash: hash(invitationToken),
      expiresAt: invitationExpiry(),
    });
    return Object.freeze({
      ...issued,
      ...(issued.outcome === "replayed" ? {} : { invitationToken }),
    });
  }
  async reissue(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & ReissueSupplierEvidenceRequestInput
    >,
  ) {
    const invitationToken = secret();
    const issued = await this.repository.reissue(organizationId, {
      ...input,
      tokenHash: hash(invitationToken),
      expiresAt: invitationExpiry(),
    });
    return Object.freeze({
      ...issued,
      ...(issued.outcome === "replayed" ? {} : { invitationToken }),
    });
  }
  review(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
        submissionId: string;
      } & ReviewSupplierEvidenceSubmissionInput
    >,
  ) {
    return this.repository.review(organizationId, input);
  }
  async reRequest(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & ReRequestSupplierEvidenceRequestInput
    >,
  ) {
    const invitationToken = secret();
    const requested = await this.repository.reRequest(organizationId, {
      ...input,
      tokenHash: hash(invitationToken),
      expiresAt: invitationExpiry(),
    });
    return Object.freeze({
      ...requested,
      ...(requested.outcome === "replayed" ? {} : { invitationToken }),
    });
  }
  markInvitationDelivery(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
        invitationId: string;
      } & MarkSupplierEvidenceInvitationDeliveryInput
    >,
  ) {
    return this.repository.markInvitationDelivery(organizationId, input);
  }
  revoke(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        requestId: string;
      } & RevokeSupplierEvidenceRequestInput
    >,
  ) {
    return this.repository.revoke(organizationId, input);
  }
  close(
    organizationId: string,
    input: Readonly<
      { actorId: string; requestId: string } & CloseSupplierEvidenceRequestInput
    >,
  ) {
    return this.repository.close(organizationId, input);
  }

  async redeem(input: Readonly<{ invitationToken: string }>) {
    const sessionToken = secret();
    const redeemed = await this.repository.redeem({
      invitationTokenHash: hash(input.invitationToken),
      sessionTokenHash: hash(sessionToken),
      sessionExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    return Object.freeze({ ...redeemed, sessionToken });
  }
  portalRequest(sessionToken: string) {
    return this.repository.portalRequest({
      sessionTokenHash: hash(sessionToken),
    });
  }

  async reserve(input: InitializeSupplierEvidencePortalUploadInput) {
    const objectKey = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ].join("/");
    const reserved = await this.repository.reserve({
      sessionTokenHash: hash(input.sessionToken),
      checklistItemId: input.checklistItemId,
      fileName: input.fileName,
      mediaType: input.mediaType,
      sha256: input.sha256,
      byteSize: input.byteSize,
      objectKey,
      uploadExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      idempotencyKey: input.idempotencyKey,
      requestDigest: digest({
        checklistItemId: input.checklistItemId,
        fileName: input.fileName,
        mediaType: input.mediaType,
        sha256: input.sha256,
        byteSize: input.byteSize,
        idempotencyKey: input.idempotencyKey,
      }),
    });
    const upload = await this.storage.createSignedUpload({
      objectKey: reserved.objectKey,
      contentType: input.mediaType,
      byteSize: input.byteSize,
    });
    return Object.freeze({ ...reserved, upload });
  }
  async finalize(
    input: Readonly<{
      sessionToken: string;
      versionId: string;
      idempotencyKey: string;
    }>,
  ) {
    const sessionTokenHash = hash(input.sessionToken);
    const upload = await this.repository.uploadForFinalization({
      sessionTokenHash,
      versionId: input.versionId,
    });
    const inspected = await this.storage.inspect({
      objectKey: upload.objectKey,
      maximumByteSize: 50 * 1024 * 1024,
    });
    return this.repository.finalize({
      sessionTokenHash,
      versionId: input.versionId,
      actualByteSize:
        inspected.outcome === "verified" ? inspected.byteSize : null,
      mediaType: inspected.outcome === "verified" ? inspected.mediaType : null,
      sha256: inspected.outcome === "verified" ? inspected.sha256 : null,
      idempotencyKey: input.idempotencyKey,
      requestDigest: digest({
        versionId: input.versionId,
        idempotencyKey: input.idempotencyKey,
      }),
    });
  }
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function secret(): string {
  return randomBytes(32).toString("base64url");
}
function invitationExpiry(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
}
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
