import type {
  LegalEntity,
  LegalEntityDependencyKind,
} from "@repo/contracts/organizations";

import type { Result } from "../../../common/domain/result";

/**
 * Immutable entity provenance supplied to Product, Reporting, and Evidence
 * owners after their own authorization checks. It intentionally contains no
 * adapter, storage, or mutable dependency-projection implementation detail.
 */
export type LegalEntityContext = Readonly<{
  organizationId: string;
  legalEntityId: string;
  legalEntityVersion: number;
  legalEntitySnapshot: LegalEntity;
}>;

export type LegalEntityContextError = Readonly<{
  code:
    | "not_found"
    | "inactive"
    | "incomplete"
    | "unavailable"
    | "malformed_provider";
}>;

/**
 * Inward contract for owning applications to validate and snapshot a legal
 * entity in their own durable transaction. It does not expose persistence.
 */
export interface LegalEntityDirectory {
  resolveActiveContext(
    organizationId: string,
    legalEntityId: string,
  ): Promise<Result<LegalEntityContext, LegalEntityContextError>>;
}

export const LEGAL_ENTITY_DIRECTORY = Symbol("LEGAL_ENTITY_DIRECTORY");

export type LegalEntityDependencyFact = Readonly<{
  recordId: string;
  count: number;
}>;

/** Retention is DB-only today but remains a lifecycle dependency authority. */
export type LegalEntityDependencyAuthorityKind =
  LegalEntityDependencyKind | "retention";

export type LegalEntityDependencyReconciliation = Readonly<{
  authorityKind: LegalEntityDependencyAuthorityKind;
  available: boolean;
  facts: readonly LegalEntityDependencyFact[];
}>;

export type LegalEntityDependencyReconciliationError = Readonly<{
  code:
    | "not_found"
    | "invalid_authority"
    | "invalid_facts"
    | "unavailable"
    | "malformed_provider";
}>;

/**
 * Owner applications project only their own committed dependency facts. The
 * legal-entity capability never imports or queries product/reporting tables.
 */
export interface LegalEntityDependencyReporter {
  reconcile(
    organizationId: string,
    legalEntityId: string,
    actorId: string,
    reconciliation: LegalEntityDependencyReconciliation,
  ): Promise<Result<void, LegalEntityDependencyReconciliationError>>;
}

export const LEGAL_ENTITY_DEPENDENCY_REPORTER = Symbol(
  "LEGAL_ENTITY_DEPENDENCY_REPORTER",
);
