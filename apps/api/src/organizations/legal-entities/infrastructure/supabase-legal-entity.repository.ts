import { Injectable } from "@nestjs/common";
import {
  legalEntitiesResponseSchema,
  legalEntityResponseSchema,
  type CreateLegalEntityInput,
  type LegalEntity,
  type LegalEntityStatus,
  type UpdateLegalEntityInput,
} from "@repo/contracts/organizations";

import { SupabaseService } from "../../../supabase/supabase.service";
import type { LegalEntityDependencyReconciliation } from "../application/legal-entity-ports";
import {
  LegalEntityProviderError,
  type LegalEntityDependencyBlocker,
  type LegalEntityRepository,
} from "../application/legal-entity-use-cases";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{
  data: unknown;
  error: Readonly<{ message: string }> | null;
}>;

interface LegalEntityRpcClient {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): PromiseLike<ProviderResult>;
}

const LIST_OUTCOMES = new Set(["found", "not_found"] as const);
const CREATE_OUTCOMES = new Set([
  "created",
  "replayed",
  "conflict",
  "idempotency_mismatch",
  "invalid_request",
  "not_found",
] as const);
const UPDATE_OUTCOMES = new Set([
  "updated",
  "conflict",
  "invalid_request",
  "not_found",
] as const);
const TRANSITION_OUTCOMES = new Set([
  "transitioned",
  "conflict",
  "invalid_state",
  "blocked",
  "not_found",
] as const);
const CONTEXT_OUTCOMES = new Set([
  "found",
  "not_found",
  "inactive",
  "incomplete",
] as const);
const RECONCILIATION_OUTCOMES = new Set([
  "reconciled",
  "not_found",
  "invalid_authority",
  "invalid_facts",
] as const);
const DEPENDENCY_BLOCKERS = new Set<LegalEntityDependencyBlocker>([
  "active_products",
  "reporting_obligations",
  "retention_requirements",
  "legal_holds",
  "dependency_authority_unavailable",
]);

/** Service-role adapter: every operation supplies the selected organization first. */
@Injectable()
export class SupabaseLegalEntityRepository implements LegalEntityRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getLegalEntities(organizationId: string, actorId: string) {
    const row = await this.singleRpc(
      "get_organization_legal_entities",
      Object.freeze({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      }),
    );
    const outcome = this.outcome(row, LIST_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    return Object.freeze({
      outcome: "found" as const,
      legalEntities: Object.freeze(
        this.parse(legalEntitiesResponseSchema, {
          legalEntities: row.legal_entities,
        }).legalEntities,
      ),
    });
  }

  async getLegalEntity(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
  ) {
    const row = await this.singleRpc(
      "get_organization_legal_entity",
      Object.freeze({
        p_organization_id: organizationId,
        p_legal_entity_id: legalEntityId,
        p_actor_user_id: actorId,
      }),
    );
    const outcome = this.outcome(row, LIST_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    return Object.freeze({
      outcome: "found" as const,
      legalEntity: this.legalEntity(row.legal_entity),
    });
  }

  async createLegalEntity(
    organizationId: string,
    actorId: string,
    input: CreateLegalEntityInput,
  ) {
    const row = await this.singleRpc(
      "create_organization_legal_entity_atomic",
      this.entityArguments(organizationId, actorId, input),
    );
    const outcome = this.outcome(row, CREATE_OUTCOMES);
    if (
      outcome === "idempotency_mismatch" ||
      outcome === "conflict" ||
      outcome === "invalid_request" ||
      outcome === "not_found"
    ) {
      return Object.freeze({ outcome });
    }
    return Object.freeze({
      outcome,
      legalEntity: this.legalEntity(row.legal_entity),
    });
  }

  async updateLegalEntity(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
    input: UpdateLegalEntityInput,
  ) {
    const row = await this.singleRpc(
      "update_organization_legal_entity_atomic",
      Object.freeze({
        ...this.entityArguments(organizationId, actorId, input),
        p_legal_entity_id: legalEntityId,
        p_expected_version: input.expectedVersion,
      }),
    );
    const outcome = this.outcome(row, UPDATE_OUTCOMES);
    if (outcome === "invalid_request" || outcome === "not_found") {
      return Object.freeze({ outcome });
    }
    return outcome === "conflict"
      ? Object.freeze({
          outcome,
          ...(row.legal_entity === null
            ? {}
            : { legalEntity: this.legalEntity(row.legal_entity) }),
        })
      : Object.freeze({
          outcome,
          legalEntity: this.legalEntity(row.legal_entity),
        });
  }

  async transitionLegalEntity(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
    expectedVersion: number,
    status: LegalEntityStatus,
  ) {
    const row = await this.singleRpc(
      "transition_organization_legal_entity_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_legal_entity_id: legalEntityId,
        p_actor_user_id: actorId,
        p_expected_version: expectedVersion,
        p_status: status,
      }),
    );
    const outcome = this.outcome(row, TRANSITION_OUTCOMES);
    if (outcome === "not_found" || outcome === "invalid_state") {
      return Object.freeze({ outcome });
    }
    if (outcome === "blocked") {
      return Object.freeze({
        outcome,
        reason: this.blocker(row.block_reason),
      });
    }
    return outcome === "conflict"
      ? Object.freeze({
          outcome,
          ...(row.legal_entity === null
            ? {}
            : { legalEntity: this.legalEntity(row.legal_entity) }),
        })
      : Object.freeze({
          outcome,
          legalEntity: this.legalEntity(row.legal_entity),
        });
  }

  async resolveActiveContext(organizationId: string, legalEntityId: string) {
    const row = await this.singleRpc(
      "resolve_active_organization_legal_entity_context",
      Object.freeze({
        p_organization_id: organizationId,
        p_legal_entity_id: legalEntityId,
      }),
    );
    const outcome = this.outcome(row, CONTEXT_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome === "inactive") return Object.freeze({ outcome });
    if (outcome === "incomplete") return Object.freeze({ outcome });
    return Object.freeze({
      outcome,
      legalEntity: this.contextEntity(
        row.context,
        organizationId,
        legalEntityId,
      ),
    });
  }

  async reconcileDependencies(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
    reconciliation: LegalEntityDependencyReconciliation,
  ) {
    const row = await this.singleRpc(
      "reconcile_organization_legal_entity_dependencies_atomic",
      Object.freeze({
        p_organization_id: organizationId,
        p_legal_entity_id: legalEntityId,
        p_actor_user_id: actorId,
        p_authority_kind: reconciliation.authorityKind,
        p_available: reconciliation.available,
        p_facts: reconciliation.facts.map((fact) => ({
          recordId: fact.recordId,
          count: fact.count,
        })),
      }),
    );
    const outcome = this.outcome(row, RECONCILIATION_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome === "invalid_authority") return Object.freeze({ outcome });
    if (outcome === "invalid_facts") return Object.freeze({ outcome });
    return Object.freeze({ outcome: "reconciled" as const });
  }

  private entityArguments(
    organizationId: string,
    actorId: string,
    input: CreateLegalEntityInput | UpdateLegalEntityInput,
  ): Readonly<Record<string, unknown>> {
    const { registeredAddress } = input;
    return Object.freeze({
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      ...("idempotencyKey" in input
        ? { p_idempotency_key: input.idempotencyKey }
        : {}),
      p_identifier: input.identifier,
      p_display_name: input.displayName,
      p_legal_name: input.legalName,
      p_address_line_1: registeredAddress.addressLine1,
      p_address_line_2: registeredAddress.addressLine2 ?? null,
      p_locality: registeredAddress.locality,
      p_administrative_area: registeredAddress.administrativeArea ?? null,
      p_postal_code: registeredAddress.postalCode,
      p_registered_address_country: registeredAddress.country,
      p_main_establishment_country: input.mainEstablishmentCountry,
      p_manufacturer_contact_name: input.manufacturerContactName,
      p_manufacturer_contact_email: input.manufacturerContactEmail,
      p_phone: input.phone ?? null,
      p_registration_identifier: input.registrationIdentifier ?? null,
      p_tax_identifier: input.taxIdentifier ?? null,
    });
  }

  private contextEntity(
    value: unknown,
    organizationId: string,
    legalEntityId: string,
  ): LegalEntity {
    const context = this.recordOrFail(value);
    if (
      context.organizationId !== organizationId ||
      context.legalEntityId !== legalEntityId
    ) {
      throw this.malformed();
    }
    const entity = this.legalEntity(context.legalEntitySnapshot);
    if (
      entity.organizationId !== organizationId ||
      entity.id !== legalEntityId ||
      context.legalEntityVersion !== entity.version
    ) {
      throw this.malformed();
    }
    return entity;
  }

  private legalEntity(value: unknown): LegalEntity {
    return this.parse(legalEntityResponseSchema, { legalEntity: value })
      .legalEntity;
  }

  private async singleRpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    let result: ProviderResult;
    try {
      result = await (
        this.supabase.admin() as unknown as LegalEntityRpcClient
      ).rpc(name, args);
    } catch {
      throw new LegalEntityProviderError("unavailable");
    }
    if (result.error) throw new LegalEntityProviderError("unavailable");
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw this.malformed();
    }
    return this.recordOrFail(result.data[0]);
  }

  private outcome<TOutcome extends string>(
    row: ProviderRow,
    allowed: ReadonlySet<TOutcome>,
  ): TOutcome {
    const outcome = row.outcome;
    if (typeof outcome !== "string" || !allowed.has(outcome as TOutcome)) {
      throw this.malformed();
    }
    return outcome as TOutcome;
  }

  private blocker(value: unknown): LegalEntityDependencyBlocker {
    if (
      typeof value !== "string" ||
      !DEPENDENCY_BLOCKERS.has(value as LegalEntityDependencyBlocker)
    ) {
      throw this.malformed();
    }
    return value as LegalEntityDependencyBlocker;
  }

  private parse<T>(
    schema: Readonly<{
      safeParse(value: unknown): Readonly<{ success: boolean; data?: T }>;
    }>,
    value: unknown,
  ): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success || parsed.data === undefined) throw this.malformed();
    return parsed.data;
  }

  private recordOrFail(value: unknown): ProviderRow {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw this.malformed();
    }
    return value as ProviderRow;
  }

  private malformed(): LegalEntityProviderError {
    return new LegalEntityProviderError("malformed");
  }
}
