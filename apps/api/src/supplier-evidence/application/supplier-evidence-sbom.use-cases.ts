import { createHash, createHmac, randomUUID } from "node:crypto";

import type {
  CompleteSupplierEvidenceSbomUploadInput,
  InitializeSupplierEvidenceSbomUploadInput,
  SupplierEvidenceEligibleSbomRequestsQuery,
} from "@repo/contracts/supplier-evidence";

import type { SupplierSbomService } from "../../sboms/supplier-sbom.service";

export class SupplierEvidenceSbomNotFoundError extends Error {}

export interface SupplierEvidenceSbomRepository {
  activate(
    input: Readonly<{
      sessionTokenHash: string;
      checklistItemId: string;
      sbomSessionTokenHash: string;
    }>,
  ): Promise<Readonly<{ outcome: "created" | "replayed" | "not_found" }>>;
  eligible(
    organizationId: string,
    input: Readonly<{
      actorId: string;
    }> &
      SupplierEvidenceEligibleSbomRequestsQuery,
  ): Promise<unknown>;
}

/** The M9 bearer selects an issued item; M3 still owns bytes, jobs, and review. */
export class SupplierEvidenceSbomUseCases {
  constructor(
    private readonly repository: SupplierEvidenceSbomRepository,
    private readonly supplierSboms: Pick<
      SupplierSbomService,
      "initializeUpload" | "completeUpload"
    >,
  ) {}

  eligible(
    organizationId: string,
    input: Readonly<{ actorId: string }> &
      SupplierEvidenceEligibleSbomRequestsQuery,
  ) {
    return this.repository.eligible(organizationId, input);
  }

  async initialize(
    input: InitializeSupplierEvidenceSbomUploadInput &
      Readonly<{ checklistItemId: string }>,
  ) {
    const token = await this.activate(
      input.sessionToken,
      input.checklistItemId,
    );
    return this.supplierSboms.initializeUpload({
      sessionToken: token,
      filename: input.fileName,
      byteSize: input.byteSize,
      mediaType: input.mediaType,
      sha256: input.sha256,
      idempotencyKey: input.idempotencyKey,
      declaredFormat: input.declaredFormat,
      declaredSpecVersion: input.declaredSpecVersion,
      correlationId: randomUUID(),
    });
  }

  async complete(
    input: CompleteSupplierEvidenceSbomUploadInput &
      Readonly<{ checklistItemId: string; sourceId: string }>,
  ) {
    const token = await this.activate(
      input.sessionToken,
      input.checklistItemId,
    );
    return this.supplierSboms.completeUpload({
      sessionToken: token,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
    });
  }

  private async activate(sessionToken: string, checklistItemId: string) {
    const token = createHmac("sha256", sessionToken)
      .update(`m9-06:${checklistItemId}`)
      .digest("base64url");
    const result = await this.repository.activate({
      sessionTokenHash: sha256(sessionToken),
      checklistItemId,
      sbomSessionTokenHash: sha256(token),
    });
    if (result.outcome !== "created" && result.outcome !== "replayed") {
      throw new SupplierEvidenceSbomNotFoundError();
    }
    return token;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
