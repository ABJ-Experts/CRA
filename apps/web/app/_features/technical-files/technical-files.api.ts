import {
  addTechnicalFileSourceRequestSchema,
  createTechnicalFileRequestSchema,
  removeTechnicalFileSourceRequestSchema,
  removeTechnicalFileSourceParamsSchema,
  cancelTechnicalFileSnapshotExportRequestSchema,
  createTechnicalFileSnapshotExportRequestSchema,
  createTechnicalFileSnapshotRequestSchema,
  technicalFileProductParamsSchema,
  technicalFileReadinessParamsSchema,
  technicalFileReadinessResponseSchema,
  technicalFileReadinessSourceParamsSchema,
  technicalFileEvidenceLinkResponseSchema,
  technicalFileEvidenceReviewResponseSchema,
  technicalFileWorkspaceResponseSchema,
  technicalFileSectionParamsSchema,
  technicalFileSectionResponseSchema,
  technicalFileSnapshotDownloadResponseSchema,
  technicalFileSnapshotDownloadQuerySchema,
  technicalFileSnapshotExportParamsSchema,
  technicalFileSnapshotExportResponseSchema,
  technicalFileSnapshotParamsSchema,
  technicalFileSnapshotResponseSchema,
  technicalFileSnapshotsResponseSchema,
  createTechnicalFileDeclarationDraftRequestSchema,
  updateTechnicalFileDeclarationDraftRequestSchema,
  issueTechnicalFileDeclarationRequestSchema,
  reissueTechnicalFileDeclarationRequestSchema,
  technicalFileDeclarationParamsSchema,
  technicalFileDeclarationPreviewResponseSchema,
  technicalFileDeclarationResponseSchema,
  technicalFileDeclarationsResponseSchema,
  technicalFileDeclarationDownloadResponseSchema,
  updateTechnicalFileSectionRequestSchema,
  recalculateTechnicalFileReadinessRequestSchema,
  reviewTechnicalFileSourceRequestSchema,
  signalTechnicalFileSourceMaterialChangeRequestSchema,
  type AddTechnicalFileSourceRequest,
  type CreateTechnicalFileRequest,
  type UpdateTechnicalFileSectionRequest,
  type RecalculateTechnicalFileReadinessRequest,
  type ReviewTechnicalFileSourceRequest,
  type SignalTechnicalFileSourceMaterialChangeRequest,
  type CancelTechnicalFileSnapshotExportRequest,
  type CreateTechnicalFileSnapshotExportRequest,
  type CreateTechnicalFileSnapshotRequest,
  type CreateTechnicalFileDeclarationDraftRequest,
  type UpdateTechnicalFileDeclarationDraftRequest,
  type IssueTechnicalFileDeclarationRequest,
  type ReissueTechnicalFileDeclarationRequest,
} from "@repo/contracts/technical-files";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

function productPath(productId: string, suffix = ""): `/${string}` {
  const parsed = technicalFileProductParamsSchema.safeParse({ productId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}/technical-file${suffix}`;
}

function sectionPath(productId: string, sectionKey: string, suffix = "") {
  const parsed = technicalFileSectionParamsSchema.safeParse({
    productId,
    sectionKey,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The technical-file section is invalid.",
      400,
    );
  }
  return `${productPath(productId, `/sections/${parsed.data.sectionKey}`)}${suffix}` as `/${string}`;
}

function readinessSourcePath(
  productId: string,
  sectionKey: string,
  sourceId: string,
  suffix: "/review" | "/material-change",
): `/${string}` {
  const parsed = technicalFileReadinessSourceParamsSchema.safeParse({
    productId,
    sectionKey,
    sourceId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The technical-file evidence link is invalid.",
      400,
    );
  }
  return sectionPath(
    parsed.data.productId,
    parsed.data.sectionKey,
    `/sources/${parsed.data.sourceId}${suffix}`,
  );
}

function snapshotPath(productId: string, snapshotId?: string): `/${string}` {
  const parsed = snapshotId
    ? technicalFileSnapshotParamsSchema.safeParse({ productId, snapshotId })
    : technicalFileProductParamsSchema.safeParse({ productId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The technical-file snapshot identifier is invalid.",
      400,
    );
  }
  return productPath(
    parsed.data.productId,
    snapshotId ? `/snapshots/${snapshotId}` : "/snapshots",
  );
}

function snapshotExportPath(
  productId: string,
  snapshotId: string,
  exportId?: string,
): `/${string}` {
  const parsed = exportId
    ? technicalFileSnapshotExportParamsSchema.safeParse({
        productId,
        snapshotId,
        exportId,
      })
    : technicalFileSnapshotParamsSchema.safeParse({ productId, snapshotId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The technical-file export identifier is invalid.",
      400,
    );
  }
  return `${snapshotPath(productId, snapshotId)}/exports${exportId ? `/${exportId}` : ""}` as `/${string}`;
}

function declarationPath(
  productId: string,
  declarationId?: string,
): `/${string}` {
  const parsed = declarationId
    ? technicalFileDeclarationParamsSchema.safeParse({
        productId,
        declarationId,
      })
    : technicalFileProductParamsSchema.safeParse({ productId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The declaration identifier is invalid.",
      400,
    );
  }
  return productPath(
    parsed.data.productId,
    declarationId ? `/declarations/${declarationId}` : "/declarations",
  );
}

function declarationPreviewPath(
  productId: string,
  snapshotId: string,
): `/${string}` {
  const parsed = technicalFileSnapshotParamsSchema.safeParse({
    productId,
    snapshotId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The technical-file snapshot identifier is invalid.",
      400,
    );
  }
  return `${declarationPath(parsed.data.productId)}/preview/${parsed.data.snapshotId}` as `/${string}`;
}

export const technicalFilesApi = Object.freeze({
  get: (productId: string, signal?: AbortSignal) =>
    authenticatedRequestJson({
      path: productPath(productId),
      schema: technicalFileWorkspaceResponseSchema,
      signal,
    }),
  create: (productId: string, input: CreateTechnicalFileRequest) =>
    authenticatedRequestJson({
      path: productPath(productId),
      method: "POST",
      schema: technicalFileWorkspaceResponseSchema,
      inputSchema: createTechnicalFileRequestSchema,
      body: input,
    }),
  getSection: (productId: string, sectionKey: string, signal?: AbortSignal) =>
    authenticatedRequestJson({
      path: sectionPath(productId, sectionKey),
      schema: technicalFileSectionResponseSchema,
      signal,
    }),
  updateSection: (
    productId: string,
    sectionKey: string,
    input: UpdateTechnicalFileSectionRequest,
  ) =>
    authenticatedRequestJson({
      path: sectionPath(productId, sectionKey),
      method: "PATCH",
      schema: technicalFileSectionResponseSchema,
      inputSchema: updateTechnicalFileSectionRequestSchema,
      body: input,
    }),
  addSource: (
    productId: string,
    sectionKey: string,
    input: AddTechnicalFileSourceRequest,
  ) =>
    authenticatedRequestJson({
      path: sectionPath(productId, sectionKey, "/sources"),
      method: "POST",
      schema: technicalFileSectionResponseSchema,
      inputSchema: addTechnicalFileSourceRequestSchema,
      body: input,
    }),
  removeSource: (
    productId: string,
    sectionKey: string,
    sourceId: string,
    input: { expectedVersion: number; idempotencyKey: string },
  ) => {
    const parsed = removeTechnicalFileSourceParamsSchema.safeParse({
      productId,
      sectionKey,
      sourceId,
    });
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid_request",
        "The technical-file source is invalid.",
        400,
      );
    }
    return authenticatedRequestJson({
      path: sectionPath(productId, sectionKey, `/sources/${sourceId}`),
      method: "DELETE",
      schema: technicalFileSectionResponseSchema,
      inputSchema: removeTechnicalFileSourceRequestSchema,
      body: input,
    });
  },
  getReadiness: (productId: string, signal?: AbortSignal) => {
    const parsed = technicalFileReadinessParamsSchema.safeParse({ productId });
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid_request",
        "The product identifier is invalid.",
        400,
      );
    }
    return authenticatedRequestJson({
      path: productPath(parsed.data.productId, "/readiness"),
      schema: technicalFileReadinessResponseSchema,
      signal,
    });
  },
  recalculateReadiness: (
    productId: string,
    input: RecalculateTechnicalFileReadinessRequest,
  ) =>
    authenticatedRequestJson({
      path: productPath(productId, "/readiness/recalculate"),
      method: "POST",
      schema: technicalFileReadinessResponseSchema,
      inputSchema: recalculateTechnicalFileReadinessRequestSchema,
      body: input,
    }),
  reviewSource: (
    productId: string,
    sectionKey: string,
    sourceId: string,
    input: ReviewTechnicalFileSourceRequest,
  ) =>
    authenticatedRequestJson({
      path: readinessSourcePath(productId, sectionKey, sourceId, "/review"),
      method: "POST",
      schema: technicalFileEvidenceReviewResponseSchema,
      inputSchema: reviewTechnicalFileSourceRequestSchema,
      body: input,
    }),
  signalSourceMaterialChange: (
    productId: string,
    sectionKey: string,
    sourceId: string,
    input: SignalTechnicalFileSourceMaterialChangeRequest,
  ) =>
    authenticatedRequestJson({
      path: readinessSourcePath(
        productId,
        sectionKey,
        sourceId,
        "/material-change",
      ),
      method: "POST",
      schema: technicalFileEvidenceLinkResponseSchema,
      inputSchema: signalTechnicalFileSourceMaterialChangeRequestSchema,
      body: input,
    }),
  listSnapshots: (productId: string, signal?: AbortSignal) =>
    authenticatedRequestJson({
      path: snapshotPath(productId),
      schema: technicalFileSnapshotsResponseSchema,
      signal,
    }),
  getSnapshot: (productId: string, snapshotId: string, signal?: AbortSignal) =>
    authenticatedRequestJson({
      path: snapshotPath(productId, snapshotId),
      schema: technicalFileSnapshotResponseSchema,
      signal,
    }),
  createSnapshot: (
    productId: string,
    input: CreateTechnicalFileSnapshotRequest,
  ) =>
    authenticatedRequestJson({
      path: snapshotPath(productId),
      method: "POST",
      schema: technicalFileSnapshotResponseSchema,
      inputSchema: createTechnicalFileSnapshotRequestSchema,
      body: input,
    }),
  createSnapshotExport: (
    productId: string,
    snapshotId: string,
    input: CreateTechnicalFileSnapshotExportRequest,
  ) =>
    authenticatedRequestJson({
      path: snapshotExportPath(productId, snapshotId),
      method: "POST",
      schema: technicalFileSnapshotExportResponseSchema,
      inputSchema: createTechnicalFileSnapshotExportRequestSchema,
      body: input,
    }),
  getSnapshotExport: (
    productId: string,
    snapshotId: string,
    exportId: string,
    signal?: AbortSignal,
  ) =>
    authenticatedRequestJson({
      path: snapshotExportPath(productId, snapshotId, exportId),
      schema: technicalFileSnapshotExportResponseSchema,
      signal,
    }),
  downloadSnapshotExport: (
    productId: string,
    snapshotId: string,
    exportId: string,
    artifact: string,
  ) => {
    const parsedArtifact = technicalFileSnapshotDownloadQuerySchema.safeParse({
      artifact,
    });
    if (!parsedArtifact.success) {
      throw new ApiClientError(
        "invalid_request",
        "The requested export artifact is invalid.",
        400,
      );
    }
    return authenticatedRequestJson({
      path: `${snapshotExportPath(productId, snapshotId, exportId)}/download?artifact=${parsedArtifact.data.artifact}` as `/${string}`,
      schema: technicalFileSnapshotDownloadResponseSchema,
    });
  },
  cancelSnapshotExport: (
    productId: string,
    snapshotId: string,
    exportId: string,
    input: CancelTechnicalFileSnapshotExportRequest,
  ) =>
    authenticatedRequestJson({
      path: snapshotExportPath(productId, snapshotId, exportId),
      method: "DELETE",
      schema: technicalFileSnapshotExportResponseSchema,
      inputSchema: cancelTechnicalFileSnapshotExportRequestSchema,
      body: input,
    }),
  listDeclarations: (productId: string, signal?: AbortSignal) =>
    authenticatedRequestJson({
      path: declarationPath(productId),
      schema: technicalFileDeclarationsResponseSchema,
      signal,
    }),
  previewDeclaration: (
    productId: string,
    snapshotId: string,
    signal?: AbortSignal,
  ) =>
    authenticatedRequestJson({
      path: declarationPreviewPath(productId, snapshotId),
      schema: technicalFileDeclarationPreviewResponseSchema,
      signal,
    }),
  saveDeclarationDraft: (
    productId: string,
    input: CreateTechnicalFileDeclarationDraftRequest,
  ) =>
    authenticatedRequestJson({
      path: declarationPath(productId),
      method: "POST",
      schema: technicalFileDeclarationResponseSchema,
      inputSchema: createTechnicalFileDeclarationDraftRequestSchema,
      body: input,
    }),
  updateDeclarationDraft: (
    productId: string,
    declarationId: string,
    input: UpdateTechnicalFileDeclarationDraftRequest,
  ) =>
    authenticatedRequestJson({
      path: declarationPath(productId, declarationId),
      method: "PATCH",
      schema: technicalFileDeclarationResponseSchema,
      inputSchema: updateTechnicalFileDeclarationDraftRequestSchema,
      body: input,
    }),
  issueDeclaration: (
    productId: string,
    declarationId: string,
    input: IssueTechnicalFileDeclarationRequest,
  ) =>
    authenticatedRequestJson({
      path: `${declarationPath(productId, declarationId)}/issue` as `/${string}`,
      method: "POST",
      schema: technicalFileDeclarationResponseSchema,
      inputSchema: issueTechnicalFileDeclarationRequestSchema,
      body: input,
    }),
  reissueDeclaration: (
    productId: string,
    declarationId: string,
    input: ReissueTechnicalFileDeclarationRequest,
  ) =>
    authenticatedRequestJson({
      path: `${declarationPath(productId, declarationId)}/reissue` as `/${string}`,
      method: "POST",
      schema: technicalFileDeclarationResponseSchema,
      inputSchema: reissueTechnicalFileDeclarationRequestSchema,
      body: input,
    }),
  downloadDeclaration: (productId: string, declarationId: string) =>
    authenticatedRequestJson({
      path: `${declarationPath(productId, declarationId)}/download` as `/${string}`,
      schema: technicalFileDeclarationDownloadResponseSchema,
    }),
});
