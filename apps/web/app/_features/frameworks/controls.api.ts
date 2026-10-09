import {
  archiveControlInputSchema,
  controlCommandResponseSchema,
  controlDetailResponseSchema,
  controlEvidenceLinkParamsSchema,
  controlListQuerySchema,
  controlListResponseSchema,
  controlMappingParamsSchema,
  controlOwnerCandidatesQuerySchema,
  controlOwnerCandidatesResponseSchema,
  controlParamsSchema,
  createControlInputSchema,
  createControlMappingInputSchema,
  endControlLinkInputSchema,
  endControlMappingInputSchema,
  linkControlEvidenceInputSchema,
  requirementCoverageParamsSchema,
  requirementCoverageQuerySchema,
  requirementCoverageResponseSchema,
  requirementApplicabilityParamsSchema,
  requirementApplicabilityInputSchema,
  requirementApplicabilityResponseSchema,
  updateControlInputSchema,
  updateControlMappingInputSchema,
  type CreateControlInput,
  type CreateControlMappingInput,
} from "@repo/contracts/frameworks";
import type { z } from "zod";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

const base = "/api/v1/frameworks/controls" as const;

function controlPath(controlId: string): `/${string}` {
  const parsed = controlParamsSchema.safeParse({ controlId });
  if (!parsed.success)
    throw new ApiClientError("invalid_request", "Invalid control ID.", 400);
  return `${base}/${parsed.data.controlId}`;
}

function linkPath(controlId: string, linkId: string): `/${string}` {
  const parsed = controlEvidenceLinkParamsSchema.safeParse({
    controlId,
    linkId,
  });
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "Invalid evidence link ID.",
      400,
    );
  return `${base}/${parsed.data.controlId}/evidence-links/${parsed.data.linkId}`;
}

function mappingPath(controlId: string, mappingId: string): `/${string}` {
  const parsed = controlMappingParamsSchema.safeParse({ controlId, mappingId });
  if (!parsed.success)
    throw new ApiClientError("invalid_request", "Invalid mapping ID.", 400);
  return `${base}/${parsed.data.controlId}/mappings/${parsed.data.mappingId}`;
}

export class ControlsApi {
  ownerCandidates(cursor?: string, signal?: AbortSignal) {
    const query = apiClient.parseInput(controlOwnerCandidatesQuerySchema, {
      limit: 100,
      cursor,
    });
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set("cursor", query.cursor);
    return authenticatedRequestJson({
      path: `/api/v1/frameworks/control-owner-candidates?${search}`,
      schema: controlOwnerCandidatesResponseSchema,
      signal,
    });
  }

  list(cursor?: string, includeArchived = false, signal?: AbortSignal) {
    const query = apiClient.parseInput(controlListQuerySchema, {
      limit: 50,
      cursor,
      includeArchived,
    });
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set("cursor", query.cursor);
    if (query.includeArchived) search.set("includeArchived", "true");
    return authenticatedRequestJson({
      path: `${base}?${search}`,
      schema: controlListResponseSchema,
      signal,
    });
  }

  get(controlId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: controlPath(controlId),
      schema: controlDetailResponseSchema,
      signal,
    });
  }

  create(input: CreateControlInput) {
    return authenticatedRequestJson({
      path: base,
      method: "POST",
      body: input,
      inputSchema: createControlInputSchema,
      schema: controlCommandResponseSchema,
    });
  }

  update(controlId: string, input: z.output<typeof updateControlInputSchema>) {
    return authenticatedRequestJson({
      path: controlPath(controlId),
      method: "PUT",
      body: input,
      inputSchema: updateControlInputSchema,
      schema: controlCommandResponseSchema,
    });
  }

  archive(
    controlId: string,
    input: z.output<typeof archiveControlInputSchema>,
  ) {
    return authenticatedRequestJson({
      path: `${controlPath(controlId)}/archive`,
      method: "POST",
      body: input,
      inputSchema: archiveControlInputSchema,
      schema: controlCommandResponseSchema,
    });
  }

  linkEvidence(
    controlId: string,
    input: z.output<typeof linkControlEvidenceInputSchema>,
  ) {
    return authenticatedRequestJson({
      path: `${controlPath(controlId)}/evidence-links`,
      method: "POST",
      body: input,
      inputSchema: linkControlEvidenceInputSchema,
      schema: controlCommandResponseSchema,
    });
  }

  endEvidenceLink(
    controlId: string,
    linkId: string,
    input: z.output<typeof endControlLinkInputSchema>,
  ) {
    return authenticatedRequestJson({
      path: linkPath(controlId, linkId),
      method: "DELETE",
      body: input,
      inputSchema: endControlLinkInputSchema,
      schema: controlCommandResponseSchema,
    });
  }

  addMapping(controlId: string, input: CreateControlMappingInput) {
    return authenticatedRequestJson({
      path: `${controlPath(controlId)}/mappings`,
      method: "POST",
      body: input,
      inputSchema: createControlMappingInputSchema,
      schema: controlCommandResponseSchema,
    });
  }

  updateMapping(
    controlId: string,
    mappingId: string,
    input: z.output<typeof updateControlMappingInputSchema>,
  ) {
    return authenticatedRequestJson({
      path: mappingPath(controlId, mappingId),
      method: "PUT",
      body: input,
      inputSchema: updateControlMappingInputSchema,
      schema: controlCommandResponseSchema,
    });
  }

  endMapping(
    controlId: string,
    mappingId: string,
    input: z.output<typeof endControlMappingInputSchema>,
  ) {
    return authenticatedRequestJson({
      path: mappingPath(controlId, mappingId),
      method: "DELETE",
      body: input,
      inputSchema: endControlMappingInputSchema,
      schema: controlCommandResponseSchema,
    });
  }

  coverage(
    packKey: string,
    versionKey: string,
    productId: string,
    cursor?: string,
    signal?: AbortSignal,
    filter: "all" | "gaps" | "evidence_backed" | "excluded" = "all",
  ) {
    const params = apiClient.parseInput(requirementCoverageParamsSchema, {
      packKey,
      versionKey,
    });
    const query = apiClient.parseInput(requirementCoverageQuerySchema, {
      productId,
      limit: 100,
      cursor,
      filter,
    });
    const search = new URLSearchParams({
      productId: query.productId,
      limit: String(query.limit),
    });
    if (query.cursor) search.set("cursor", query.cursor);
    if (query.filter !== "all") search.set("filter", query.filter);
    return authenticatedRequestJson({
      path: `/api/v1/frameworks/${encodeURIComponent(params.packKey)}/versions/${encodeURIComponent(params.versionKey)}/coverage?${search}`,
      schema: requirementCoverageResponseSchema,
      signal,
    });
  }

  updateApplicability(
    packKey: string,
    versionKey: string,
    requirementKey: string,
    input: z.output<typeof requirementApplicabilityInputSchema>,
  ) {
    const params = apiClient.parseInput(requirementApplicabilityParamsSchema, {
      packKey,
      versionKey,
      requirementKey,
    });
    return authenticatedRequestJson({
      path: `/api/v1/frameworks/${encodeURIComponent(params.packKey)}/versions/${encodeURIComponent(params.versionKey)}/requirements/${encodeURIComponent(params.requirementKey)}/applicability`,
      method: "PUT",
      body: input,
      inputSchema: requirementApplicabilityInputSchema,
      schema: requirementApplicabilityResponseSchema,
    });
  }
}

export const controlsApi = new ControlsApi();
