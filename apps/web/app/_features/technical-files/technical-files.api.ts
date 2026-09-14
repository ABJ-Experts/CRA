import {
  addTechnicalFileSourceRequestSchema,
  createTechnicalFileRequestSchema,
  removeTechnicalFileSourceRequestSchema,
  removeTechnicalFileSourceParamsSchema,
  technicalFileProductParamsSchema,
  technicalFileWorkspaceResponseSchema,
  technicalFileSectionParamsSchema,
  technicalFileSectionResponseSchema,
  updateTechnicalFileSectionRequestSchema,
  type AddTechnicalFileSourceRequest,
  type CreateTechnicalFileRequest,
  type UpdateTechnicalFileSectionRequest,
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
});
