import { Injectable } from "@nestjs/common";
import {
  findingResponsibleSuppliersResolutionSchema,
  supplierContactSchema,
  supplierDetailSchema,
  supplierDuplicateCandidateSchema,
  supplierResponsibilitySchema,
  supplierSummarySchema,
  type SupplierDetail,
} from "@repo/contracts/suppliers";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  SupplierRegistryConflictError,
  SupplierRegistryDuplicateCandidatesError,
  SupplierRegistryForbiddenError,
  SupplierRegistryInvalidRequestError,
  type SupplierRegistryRepository,
} from "../application/supplier-registry-use-cases";

type Rpc = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};

type RpcRow = Readonly<{ outcome?: unknown; result?: unknown }>;

/**
 * All mutations are delegated to SECURITY DEFINER RPCs.  The service role
 * client is therefore still explicitly organization-scoped in every call.
 */
@Injectable()
export class SupabaseSupplierRegistryRepository implements SupplierRegistryRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async listSuppliers(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["listSuppliers"]>[1],
  ) {
    const result = await this.call("list_supplier_organizations_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_search: input.search ?? null,
      p_include_archived: input.includeArchived ?? false,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    const row = this.row(result);
    this.throwFor(row);
    if (row?.outcome !== "found") throw unavailable();
    const value = asRecord(row.result);
    const items = asArray(value.items).map((item) =>
      supplierSummarySchema.parse(item),
    );
    const nextCursor = nullableString(value.nextCursor);
    return Object.freeze({ items: Object.freeze(items), nextCursor });
  }

  async getSupplier(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["getSupplier"]>[1],
  ) {
    return this.supplierDetail("get_supplier_organization_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_supplier_id: input.supplierId,
    });
  }

  async createSupplier(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["createSupplier"]>[1],
  ) {
    const response = await this.call("create_supplier_organization_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_name: input.name,
      p_legal_name: input.legalName ?? null,
      p_website: input.website ?? null,
      p_criticality: input.criticality,
      p_duplicate_candidate_ids: [...input.duplicateCandidateIdsConfirmed],
      p_idempotency_key: input.idempotencyKey,
    });
    const row = this.row(response);
    if (row?.outcome === "duplicate_confirmation_required") {
      const candidates = asArray(asRecord(row.result).duplicateCandidates).map(
        (candidate) => {
          const value = asRecord(candidate);
          return supplierDuplicateCandidateSchema.parse({
            id: value.id,
            name: value.name,
            criticality: value.criticality,
            state: value.state,
          });
        },
      );
      throw new SupplierRegistryDuplicateCandidatesError(candidates);
    }
    this.throwFor(row);
    if (row?.outcome !== "created" && row?.outcome !== "replayed")
      throw unavailable();
    return supplierDetailSchema.parse(row.result);
  }

  async updateSupplier(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["updateSupplier"]>[1],
  ) {
    return this.supplierDetail(
      "update_supplier_organization_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_patch: patch(input, ["name", "legalName", "website", "criticality"]),
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      ["updated", "replayed"],
    );
  }

  async archiveSupplier(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["archiveSupplier"]>[1],
  ) {
    return this.supplierDetail(
      "archive_supplier_organization_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
      ["archived", "replayed"],
    );
  }

  async createContact(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["createContact"]>[1],
  ) {
    return this.contact(
      "create_supplier_contact_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_name: input.name,
        p_email: input.email ?? null,
        p_role: input.role ?? null,
        p_phone: input.phone ?? null,
        p_idempotency_key: input.idempotencyKey,
      },
      ["created", "replayed"],
    );
  }

  async updateContact(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["updateContact"]>[1],
  ) {
    return this.contact(
      "update_supplier_contact_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_contact_id: input.contactId,
        p_patch: patch(input, ["name", "email", "role", "phone"]),
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      ["updated", "replayed"],
    );
  }

  async archiveContact(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["archiveContact"]>[1],
  ) {
    return this.contact(
      "archive_supplier_contact_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_contact_id: input.contactId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
      ["archived", "replayed"],
    );
  }

  async createResponsibility(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["createResponsibility"]>[1],
  ) {
    return this.responsibility(
      "create_supplier_component_responsibility_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_product_id: input.productId,
        p_release_id: input.releaseId,
        p_occurrence_id: input.occurrenceId,
        p_provenance: input.provenance,
        p_supplier_request_id: input.supplierRequestId ?? null,
        p_idempotency_key: input.idempotencyKey,
      },
      ["created", "replayed"],
    );
  }

  async endResponsibility(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["endResponsibility"]>[1],
  ) {
    return this.responsibility(
      "end_supplier_component_responsibility_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_responsibility_id: input.responsibilityId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason,
        p_superseded_by_responsibility_id:
          input.supersededByResponsibilityId ?? null,
        p_idempotency_key: input.idempotencyKey,
      },
      ["ended", "replayed"],
    );
  }

  async associateRequest(
    organizationId: string,
    input: Parameters<SupplierRegistryRepository["associateRequest"]>[1],
  ) {
    return this.supplierDetail(
      "associate_supplier_sbom_request_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_request_id: input.requestId,
        p_idempotency_key: input.idempotencyKey,
      },
      ["associated", "replayed"],
    );
  }

  async findingResponsibleSuppliers(
    organizationId: string,
    input: Parameters<
      SupplierRegistryRepository["findingResponsibleSuppliers"]
    >[1],
  ) {
    const result = await this.call("get_finding_responsible_suppliers_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_finding_id: input.findingId,
    });
    const row = this.row(result);
    this.throwFor(row);
    if (row?.outcome === "not_found") return null;
    if (row?.outcome !== "found") throw unavailable();
    return findingResponsibleSuppliersResolutionSchema.parse(row.result);
  }

  private async supplierDetail(
    procedure: string,
    args: Record<string, unknown>,
    successfulOutcomes: readonly string[] = ["found"],
  ): Promise<SupplierDetail | null> {
    const row = this.row(await this.call(procedure, args));
    this.throwFor(row);
    if (row?.outcome === "not_found") return null;
    if (!row || !successfulOutcomes.includes(stringValue(row.outcome)))
      throw unavailable();
    return supplierDetailSchema.parse(row.result);
  }

  private async contact(
    procedure: string,
    args: Record<string, unknown>,
    successfulOutcomes: readonly string[],
  ) {
    const row = this.row(await this.call(procedure, args));
    this.throwFor(row);
    if (row?.outcome === "not_found") return null;
    if (!row || !successfulOutcomes.includes(stringValue(row.outcome)))
      throw unavailable();
    return supplierContactSchema.parse(asRecord(row.result).contact);
  }

  private async responsibility(
    procedure: string,
    args: Record<string, unknown>,
    successfulOutcomes: readonly string[],
  ) {
    const row = this.row(await this.call(procedure, args));
    this.throwFor(row);
    if (row?.outcome === "not_found") return null;
    if (!row || !successfulOutcomes.includes(stringValue(row.outcome)))
      throw unavailable();
    return supplierResponsibilitySchema.parse(
      asRecord(row.result).responsibility,
    );
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const response = await this.client().rpc(name, args);
    if (response.error) throw unavailable();
    return response.data;
  }

  private client(): Rpc {
    return this.supabase.admin() as unknown as Rpc;
  }

  private row(value: unknown): RpcRow | null {
    const rows = asArray(value);
    const row = rows[0];
    return isRecord(row) ? row : null;
  }

  private throwFor(row: RpcRow | null): void {
    switch (row?.outcome) {
      case "forbidden":
        throw new SupplierRegistryForbiddenError();
      case "invalid_request":
      case "invalid_reference":
        throw new SupplierRegistryInvalidRequestError();
      case "conflict":
      case "idempotency_conflict":
      case "idempotency_mismatch":
        throw new SupplierRegistryConflictError();
    }
  }
}

function patch(input: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(input, field))
      .map((field) => [field, input[field]]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw unavailable();
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  throw unavailable();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string"
    ? value
    : value === null
      ? null
      : (() => {
          throw unavailable();
        })();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function unavailable(): Error {
  return new Error("Supplier registry database operation failed.");
}
