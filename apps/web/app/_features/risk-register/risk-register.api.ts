import {
  acceptResidualRiskRequestSchema,
  archiveRiskRegisterRiskRequestSchema,
  createRiskRegisterRiskRequestSchema,
  riskRegisterProductParamsSchema,
  riskRegisterRiskParamsSchema,
  riskRegisterRiskResponseSchema,
  riskRegisterWorkspaceResponseSchema,
  updateRiskRegisterRiskRequestSchema,
  type AcceptResidualRiskRequest,
  type ArchiveRiskRegisterRiskRequest,
  type CreateRiskRegisterRiskRequest,
  type UpdateRiskRegisterRiskRequest,
} from "@repo/contracts/risk-registers";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

function productPath(productId: string, suffix = ""): `/${string}` {
  const parsed = riskRegisterProductParamsSchema.safeParse({ productId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The product identifier is invalid.",
      400,
    );
  }
  return `/api/v1/products/${parsed.data.productId}/technical-file/risk-register${suffix}`;
}

function riskPath(
  productId: string,
  riskId: string,
  suffix = "",
): `/${string}` {
  const parsed = riskRegisterRiskParamsSchema.safeParse({ productId, riskId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The risk identifier is invalid.",
      400,
    );
  }
  return productPath(
    parsed.data.productId,
    `/risks/${parsed.data.riskId}${suffix}`,
  );
}

export const riskRegisterApi = Object.freeze({
  get: (productId: string, signal?: AbortSignal) =>
    authenticatedRequestJson({
      path: productPath(productId),
      schema: riskRegisterWorkspaceResponseSchema,
      signal,
    }),
  createRisk: (productId: string, input: CreateRiskRegisterRiskRequest) =>
    authenticatedRequestJson({
      path: productPath(productId, "/risks"),
      method: "POST",
      schema: riskRegisterRiskResponseSchema,
      inputSchema: createRiskRegisterRiskRequestSchema,
      body: input,
    }),
  getRisk: (productId: string, riskId: string, signal?: AbortSignal) =>
    authenticatedRequestJson({
      path: riskPath(productId, riskId),
      schema: riskRegisterRiskResponseSchema,
      signal,
    }),
  updateRisk: (
    productId: string,
    riskId: string,
    input: UpdateRiskRegisterRiskRequest,
  ) =>
    authenticatedRequestJson({
      path: riskPath(productId, riskId),
      method: "PATCH",
      schema: riskRegisterRiskResponseSchema,
      inputSchema: updateRiskRegisterRiskRequestSchema,
      body: input,
    }),
  acceptResidualRisk: (
    productId: string,
    riskId: string,
    input: AcceptResidualRiskRequest,
  ) =>
    authenticatedRequestJson({
      path: riskPath(productId, riskId, "/accept-residual-risk"),
      method: "POST",
      schema: riskRegisterRiskResponseSchema,
      inputSchema: acceptResidualRiskRequestSchema,
      body: input,
    }),
  archiveRisk: (
    productId: string,
    riskId: string,
    input: ArchiveRiskRegisterRiskRequest,
  ) =>
    authenticatedRequestJson({
      path: riskPath(productId, riskId),
      method: "DELETE",
      schema: riskRegisterRiskResponseSchema,
      inputSchema: archiveRiskRegisterRiskRequestSchema,
      body: input,
    }),
});
