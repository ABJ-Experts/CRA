import {
  archiveSupplierContactInputSchema,
  archiveSupplierInputSchema,
  associateSupplierRequestInputSchema,
  createSupplierContactInputSchema,
  createSupplierInputSchema,
  createSupplierResponsibilityInputSchema,
  endSupplierResponsibilityInputSchema,
  findingResponsibleSuppliersParamsSchema,
  findingResponsibleSuppliersResponseSchema,
  supplierContactParamsSchema,
  supplierContactResponseSchema,
  supplierListQuerySchema,
  supplierParamsSchema,
  supplierRequestParamsSchema,
  supplierResponsibilityParamsSchema,
  supplierResponsibilityResponseSchema,
  supplierResponseSchema,
  suppliersResponseSchema,
  updateSupplierContactInputSchema,
  updateSupplierInputSchema,
  type ArchiveSupplierContactInput,
  type ArchiveSupplierInput,
  type AssociateSupplierRequestInput,
  type CreateSupplierContactInput,
  type CreateSupplierInput,
  type CreateSupplierResponsibilityInput,
  type EndSupplierResponsibilityInput,
  type SupplierListQuery,
  type UpdateSupplierContactInput,
  type UpdateSupplierInput,
} from "@repo/contracts/suppliers";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

function supplierPath(supplierId?: string): `/${string}` {
  if (supplierId === undefined) return "/api/v1/suppliers";
  const parsed = supplierParamsSchema.safeParse({ supplierId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The supplier identifier is invalid.",
      400,
    );
  }
  return `/api/v1/suppliers/${parsed.data.supplierId}`;
}

function contactPath(supplierId: string, contactId?: string): `/${string}` {
  if (contactId === undefined) return `${supplierPath(supplierId)}/contacts`;
  const parsed = supplierContactParamsSchema.safeParse({
    supplierId,
    contactId,
  });
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "The contact identifier is invalid.",
      400,
    );
  return `${supplierPath(parsed.data.supplierId)}/contacts/${parsed.data.contactId}`;
}

function responsibilityPath(
  supplierId: string,
  responsibilityId?: string,
): `/${string}` {
  if (responsibilityId === undefined)
    return `${supplierPath(supplierId)}/responsibilities`;
  const parsed = supplierResponsibilityParamsSchema.safeParse({
    supplierId,
    responsibilityId,
  });
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "The responsibility identifier is invalid.",
      400,
    );
  return `${supplierPath(parsed.data.supplierId)}/responsibilities/${parsed.data.responsibilityId}`;
}

function requestAssociationPath(
  supplierId: string,
  requestId: string,
): `/${string}` {
  const parsed = supplierRequestParamsSchema.safeParse({
    supplierId,
    requestId,
  });
  if (!parsed.success)
    throw new ApiClientError(
      "invalid_request",
      "The request identifier is invalid.",
      400,
    );
  return `${supplierPath(parsed.data.supplierId)}/requests/${parsed.data.requestId}`;
}

function listPath(query: SupplierListQuery): `/${string}` {
  const params = new URLSearchParams();
  if (query.search !== undefined) params.set("search", query.search);
  if (query.includeArchived !== undefined)
    params.set("includeArchived", String(query.includeArchived));
  params.set("limit", String(query.limit));
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  return `/api/v1/suppliers?${params.toString()}`;
}

/** Focused browser transport for the internal supplier registry. */
export class SuppliersApi {
  list(input: Partial<SupplierListQuery> = {}, signal?: AbortSignal) {
    const query = apiClient.parseInput(supplierListQuerySchema, input);
    return authenticatedRequestJson({
      path: listPath(query),
      schema: suppliersResponseSchema,
      signal,
    });
  }

  detail(supplierId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: supplierPath(supplierId),
      schema: supplierResponseSchema,
      signal,
    });
  }

  create(input: CreateSupplierInput) {
    return authenticatedRequestJson({
      path: supplierPath(),
      method: "POST",
      body: apiClient.parseInput(createSupplierInputSchema, input),
      inputSchema: createSupplierInputSchema,
      schema: supplierResponseSchema,
    });
  }

  update(supplierId: string, input: UpdateSupplierInput) {
    return authenticatedRequestJson({
      path: supplierPath(supplierId),
      method: "PATCH",
      body: apiClient.parseInput(updateSupplierInputSchema, input),
      inputSchema: updateSupplierInputSchema,
      schema: supplierResponseSchema,
    });
  }

  archive(supplierId: string, input: ArchiveSupplierInput) {
    return authenticatedRequestJson({
      path: `${supplierPath(supplierId)}/archive`,
      method: "POST",
      body: apiClient.parseInput(archiveSupplierInputSchema, input),
      inputSchema: archiveSupplierInputSchema,
      schema: supplierResponseSchema,
    });
  }

  createContact(supplierId: string, input: CreateSupplierContactInput) {
    return authenticatedRequestJson({
      path: contactPath(supplierId),
      method: "POST",
      body: apiClient.parseInput(createSupplierContactInputSchema, input),
      inputSchema: createSupplierContactInputSchema,
      schema: supplierContactResponseSchema,
    });
  }

  updateContact(
    supplierId: string,
    contactId: string,
    input: UpdateSupplierContactInput,
  ) {
    return authenticatedRequestJson({
      path: contactPath(supplierId, contactId),
      method: "PATCH",
      body: apiClient.parseInput(updateSupplierContactInputSchema, input),
      inputSchema: updateSupplierContactInputSchema,
      schema: supplierContactResponseSchema,
    });
  }

  archiveContact(
    supplierId: string,
    contactId: string,
    input: ArchiveSupplierContactInput,
  ) {
    return authenticatedRequestJson({
      path: `${contactPath(supplierId, contactId)}/archive`,
      method: "POST",
      body: apiClient.parseInput(archiveSupplierContactInputSchema, input),
      inputSchema: archiveSupplierContactInputSchema,
      schema: supplierContactResponseSchema,
    });
  }

  createResponsibility(
    supplierId: string,
    input: CreateSupplierResponsibilityInput,
  ) {
    return authenticatedRequestJson({
      path: responsibilityPath(supplierId),
      method: "POST",
      body: apiClient.parseInput(
        createSupplierResponsibilityInputSchema,
        input,
      ),
      inputSchema: createSupplierResponsibilityInputSchema,
      schema: supplierResponsibilityResponseSchema,
    });
  }

  endResponsibility(
    supplierId: string,
    responsibilityId: string,
    input: EndSupplierResponsibilityInput,
  ) {
    return authenticatedRequestJson({
      path: `${responsibilityPath(supplierId, responsibilityId)}/end`,
      method: "POST",
      body: apiClient.parseInput(endSupplierResponsibilityInputSchema, input),
      inputSchema: endSupplierResponsibilityInputSchema,
      schema: supplierResponsibilityResponseSchema,
    });
  }

  associateRequest(
    supplierId: string,
    requestId: string,
    input: AssociateSupplierRequestInput,
  ) {
    return authenticatedRequestJson({
      path: requestAssociationPath(supplierId, requestId),
      method: "POST",
      body: apiClient.parseInput(associateSupplierRequestInputSchema, input),
      inputSchema: associateSupplierRequestInputSchema,
      schema: supplierResponseSchema,
    });
  }

  resolveFinding(findingId: string, signal?: AbortSignal) {
    const parsed = findingResponsibleSuppliersParamsSchema.safeParse({
      findingId,
    });
    if (!parsed.success)
      throw new ApiClientError(
        "invalid_request",
        "The finding identifier is invalid.",
        400,
      );
    return authenticatedRequestJson({
      path: `/api/v1/findings/${parsed.data.findingId}/responsible-suppliers`,
      schema: findingResponsibleSuppliersResponseSchema,
      signal,
    });
  }
}

export const suppliersApi = Object.freeze(new SuppliersApi());
