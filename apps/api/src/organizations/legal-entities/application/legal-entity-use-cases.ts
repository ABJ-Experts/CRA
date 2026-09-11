import type {
  CreateLegalEntityInput,
  LegalEntity,
  LegalEntityStatus,
  UpdateLegalEntityInput,
} from "@repo/contracts/organizations";

import type { Result } from "../../../common/domain/result";
import { failure, success } from "../../../common/domain/result";
import type {
  LegalEntityContext,
  LegalEntityContextError,
  LegalEntityDependencyReconciliation,
  LegalEntityDependencyReconciliationError,
  LegalEntityDependencyReporter,
  LegalEntityDirectory,
} from "./legal-entity-ports";

export type LegalEntityDependencyBlocker =
  | "active_products"
  | "reporting_obligations"
  | "retention_requirements"
  | "legal_holds"
  | "dependency_authority_unavailable";

export type LegalEntityRepository = Readonly<{
  getLegalEntities(
    organizationId: string,
    actorId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; legalEntities: readonly LegalEntity[] }>
    | Readonly<{ outcome: "not_found" }>
  >;
  getLegalEntity(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; legalEntity: LegalEntity }>
    | Readonly<{ outcome: "not_found" }>
  >;
  createLegalEntity(
    organizationId: string,
    actorId: string,
    input: CreateLegalEntityInput,
  ): Promise<
    | Readonly<{ outcome: "created"; legalEntity: LegalEntity }>
    | Readonly<{ outcome: "replayed"; legalEntity: LegalEntity }>
    | Readonly<{ outcome: "idempotency_mismatch" }>
    | Readonly<{ outcome: "conflict" }>
    | Readonly<{ outcome: "not_found" }>
    | Readonly<{ outcome: "invalid_request" }>
  >;
  updateLegalEntity(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
    input: UpdateLegalEntityInput,
  ): Promise<
    | Readonly<{ outcome: "updated"; legalEntity: LegalEntity }>
    | Readonly<{ outcome: "conflict"; legalEntity?: LegalEntity }>
    | Readonly<{ outcome: "not_found" }>
    | Readonly<{ outcome: "invalid_request" }>
  >;
  transitionLegalEntity(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
    expectedVersion: number,
    status: LegalEntityStatus,
  ): Promise<
    | Readonly<{ outcome: "transitioned"; legalEntity: LegalEntity }>
    | Readonly<{ outcome: "conflict"; legalEntity?: LegalEntity }>
    | Readonly<{ outcome: "blocked"; reason: LegalEntityDependencyBlocker }>
    | Readonly<{ outcome: "not_found" }>
    | Readonly<{ outcome: "invalid_state" }>
  >;
  resolveActiveContext(
    organizationId: string,
    legalEntityId: string,
  ): Promise<
    | Readonly<{ outcome: "found"; legalEntity: LegalEntity }>
    | Readonly<{ outcome: "not_found" }>
    | Readonly<{ outcome: "inactive" }>
    | Readonly<{ outcome: "incomplete" }>
  >;
  reconcileDependencies(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
    reconciliation: LegalEntityDependencyReconciliation,
  ): Promise<
    | Readonly<{ outcome: "reconciled" }>
    | Readonly<{ outcome: "not_found" }>
    | Readonly<{ outcome: "invalid_authority" }>
    | Readonly<{ outcome: "invalid_facts" }>
  >;
}>;

export const LEGAL_ENTITY_REPOSITORY = Symbol("LEGAL_ENTITY_REPOSITORY");

export type LegalEntityError = Readonly<{
  code:
    | "invalid_request"
    | "conflict"
    | "not_found"
    | "invalid_state"
    | "dependency_blocked"
    | "inactive"
    | "incomplete"
    | "invalid_authority"
    | "invalid_facts"
    | "unavailable"
    | "malformed_provider";
  current?: LegalEntity;
  reason?: LegalEntityDependencyBlocker;
}>;

export class LegalEntityProviderError extends Error {
  readonly name = "LegalEntityProviderError";

  constructor(readonly code: "unavailable" | "malformed") {
    super(code);
  }
}

type LegalEntityResult<T> = Result<T, LegalEntityError>;

/** Framework-free legal-entity workflow and integration-port implementation. */
export class LegalEntityUseCases
  implements LegalEntityDirectory, LegalEntityDependencyReporter
{
  constructor(private readonly repository: LegalEntityRepository) {}

  async list(
    organizationId: string,
    actorId: string,
  ): Promise<
    LegalEntityResult<Readonly<{ legalEntities: readonly LegalEntity[] }>>
  > {
    try {
      const result = await this.repository.getLegalEntities(
        organizationId,
        actorId,
      );
      if (result.outcome === "not_found") return this.notFound();
      return success(
        Object.freeze({
          legalEntities: Object.freeze([...result.legalEntities]),
        }),
      );
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async get(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      legalEntityId: string;
    }>,
  ): Promise<LegalEntityResult<Readonly<{ legalEntity: LegalEntity }>>> {
    try {
      const result = await this.repository.getLegalEntity(
        command.organizationId,
        command.legalEntityId,
        command.actorId,
      );
      return result.outcome === "found"
        ? success(Object.freeze({ legalEntity: result.legalEntity }))
        : this.notFound();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async create(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: CreateLegalEntityInput;
    }>,
  ): Promise<LegalEntityResult<Readonly<{ legalEntity: LegalEntity }>>> {
    try {
      const result = await this.repository.createLegalEntity(
        command.organizationId,
        command.actorId,
        command.input,
      );
      if (result.outcome === "not_found") return this.notFound();
      if (result.outcome === "invalid_request") return this.invalidRequest();
      if (
        result.outcome === "idempotency_mismatch" ||
        result.outcome === "conflict"
      ) {
        return this.conflict();
      }
      return success(Object.freeze({ legalEntity: result.legalEntity }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async update(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      legalEntityId: string;
      input: UpdateLegalEntityInput;
    }>,
  ): Promise<LegalEntityResult<Readonly<{ legalEntity: LegalEntity }>>> {
    try {
      const result = await this.repository.updateLegalEntity(
        command.organizationId,
        command.legalEntityId,
        command.actorId,
        command.input,
      );
      if (result.outcome === "not_found") return this.notFound();
      if (result.outcome === "invalid_request") return this.invalidRequest();
      if (result.outcome === "conflict") {
        return failure(
          Object.freeze({
            code: "conflict" as const,
            ...(result.legalEntity ? { current: result.legalEntity } : {}),
          }),
        );
      }
      return success(Object.freeze({ legalEntity: result.legalEntity }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async transition(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      legalEntityId: string;
      expectedVersion: number;
      status: LegalEntityStatus;
    }>,
  ): Promise<LegalEntityResult<Readonly<{ legalEntity: LegalEntity }>>> {
    try {
      const result = await this.repository.transitionLegalEntity(
        command.organizationId,
        command.legalEntityId,
        command.actorId,
        command.expectedVersion,
        command.status,
      );
      if (result.outcome === "not_found") return this.notFound();
      if (result.outcome === "invalid_state") {
        return failure(Object.freeze({ code: "invalid_state" as const }));
      }
      if (result.outcome === "blocked") {
        return failure(
          Object.freeze({
            code: "dependency_blocked" as const,
            reason: result.reason,
          }),
        );
      }
      if (result.outcome === "conflict") {
        return failure(
          Object.freeze({
            code: "conflict" as const,
            ...(result.legalEntity ? { current: result.legalEntity } : {}),
          }),
        );
      }
      return success(Object.freeze({ legalEntity: result.legalEntity }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async resolveActiveContext(
    organizationId: string,
    legalEntityId: string,
  ): Promise<Result<LegalEntityContext, LegalEntityContextError>> {
    try {
      const result = await this.repository.resolveActiveContext(
        organizationId,
        legalEntityId,
      );
      if (result.outcome !== "found") {
        return failure(Object.freeze({ code: result.outcome }));
      }
      if (result.legalEntity.status !== "active") {
        return failure(Object.freeze({ code: "inactive" as const }));
      }
      if (result.legalEntity.completionStatus !== "complete") {
        return failure(Object.freeze({ code: "incomplete" as const }));
      }
      return success(
        Object.freeze({
          organizationId,
          legalEntityId: result.legalEntity.id,
          legalEntityVersion: result.legalEntity.version,
          legalEntitySnapshot: immutableEntitySnapshot(result.legalEntity),
        }),
      );
    } catch (error) {
      return this.contextProviderFailure(error);
    }
  }

  async reconcile(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
    reconciliation: LegalEntityDependencyReconciliation,
  ): Promise<Result<void, LegalEntityDependencyReconciliationError>> {
    try {
      const result = await this.repository.reconcileDependencies(
        organizationId,
        legalEntityId,
        actorId,
        immutableReconciliation(reconciliation),
      );
      if (result.outcome === "reconciled") return success(undefined);
      return failure(Object.freeze({ code: result.outcome }));
    } catch (error) {
      return this.reconciliationProviderFailure(error);
    }
  }

  private notFound<T>(): LegalEntityResult<T> {
    return failure(Object.freeze({ code: "not_found" as const }));
  }

  private invalidRequest<T>(): LegalEntityResult<T> {
    return failure(Object.freeze({ code: "invalid_request" as const }));
  }

  private conflict<T>(): LegalEntityResult<T> {
    return failure(Object.freeze({ code: "conflict" as const }));
  }

  private providerFailure(error: unknown): LegalEntityResult<never> {
    const code =
      error instanceof LegalEntityProviderError && error.code === "malformed"
        ? "malformed_provider"
        : "unavailable";
    return failure(Object.freeze({ code }));
  }

  private contextProviderFailure(
    error: unknown,
  ): Result<never, LegalEntityContextError> {
    const code =
      error instanceof LegalEntityProviderError && error.code === "malformed"
        ? "malformed_provider"
        : "unavailable";
    return failure(Object.freeze({ code }));
  }

  private reconciliationProviderFailure(
    error: unknown,
  ): Result<never, LegalEntityDependencyReconciliationError> {
    const code =
      error instanceof LegalEntityProviderError && error.code === "malformed"
        ? "malformed_provider"
        : "unavailable";
    return failure(Object.freeze({ code }));
  }
}

function immutableEntitySnapshot(entity: LegalEntity): LegalEntity {
  const snapshot =
    entity.completionStatus === "needs_completion"
      ? {
          ...entity,
          dependencyProjections: entity.dependencyProjections.map(
            (projection) => ({ ...projection }),
          ),
        }
      : {
          ...entity,
          registeredAddress: { ...entity.registeredAddress },
          dependencyProjections: entity.dependencyProjections.map(
            (projection) => ({ ...projection }),
          ),
        };

  // Shared Zod output types are mutable because they also model parsed wire
  // values. This context is an inter-application provenance boundary, so make
  // the private clone deeply immutable before exposing it through the port.
  return deepFreeze(snapshot);
}

function immutableReconciliation(
  reconciliation: LegalEntityDependencyReconciliation,
): LegalEntityDependencyReconciliation {
  return Object.freeze({
    authorityKind: reconciliation.authorityKind,
    available: reconciliation.available,
    facts: Object.freeze(
      reconciliation.facts.map((fact) =>
        Object.freeze({ recordId: fact.recordId, count: fact.count }),
      ),
    ),
  });
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
