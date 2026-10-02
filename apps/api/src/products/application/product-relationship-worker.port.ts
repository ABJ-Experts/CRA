import type {
  ProductRelationshipGraphEventCheckpoint as ProductRelationshipGraphEventCheckpointInput,
  ProductRelationshipGraphEventScope,
  RelationshipPropagationCandidate,
} from "@repo/contracts/products";

/**
 * Product-owned, service-worker view of a relationship graph event. The
 * outbox payload deliberately remains private to the products module; callers
 * receive only the propagation scopes needed to re-evaluate an opaque finding.
 */
export type ProductRelationshipGraphEventDescription = Readonly<{
  eventId: string;
  organizationId: string;
  graphVersion: number;
  eventKey: string;
  occurredAt: string;
  deliveryCursor: string | null;
  sourceScopes: readonly ProductRelationshipGraphEventScope[];
}>;

export type ProductRelationshipGraphEventClaim =
  | Readonly<{
      outcome: "claimed";
      eventId: string;
      organizationId: string;
      graphVersion: number;
      eventKey: string;
      checkpointVersion: number;
      deliveryCursor: string | null;
      leaseOwner: string;
      retryCount: number;
    }>
  | Readonly<{
      outcome: "none_available" | "conflict" | "not_found" | "invalid_request";
    }>;

export type ProductRelationshipGraphEventCompletion = Readonly<{
  outcome:
    "completed" | "delivered" | "conflict" | "not_found" | "invalid_request";
}>;

export type ProductRelationshipGraphEventCheckpoint = Readonly<{
  outcome:
    | "scheduled"
    | "completed"
    | "delivered"
    | "obsolete"
    | "conflict"
    | "not_found"
    | "invalid_request";
}>;

export type ProductRelationshipGraphEventFailure = Readonly<{
  outcome:
    | "retry_scheduled"
    | "dead_letter"
    | "conflict"
    | "not_found"
    | "invalid_request";
}>;

/**
 * Explicit product boundary for consuming the graph-change outbox. A finding
 * owner can lease an event and ask products to translate it into propagation
 * scopes, but cannot read the products outbox or relationship tables.
 */
export interface ProductRelationshipGraphEventWorkerPort {
  dueOrganizationIds(): Promise<readonly string[]>;
  claim(
    command: Readonly<{
      organizationId: string;
      workerId: string;
      leaseSeconds: number;
    }>,
  ): Promise<ProductRelationshipGraphEventClaim>;
  describe(
    command: Readonly<{
      organizationId: string;
      eventId: string;
      workerId: string;
      checkpointVersion: number;
    }>,
  ): Promise<
    | Readonly<{
        outcome: "found";
        event: ProductRelationshipGraphEventDescription;
      }>
    | Readonly<{
        outcome: "obsolete" | "conflict" | "not_found" | "invalid_request";
      }>
  >;
  checkpoint(
    command: Readonly<{
      organizationId: string;
      eventId: string;
      workerId: string;
      checkpointVersion: number;
      checkpoint: ProductRelationshipGraphEventCheckpointInput;
    }>,
  ): Promise<ProductRelationshipGraphEventCheckpoint>;
  complete(
    command: Readonly<{
      organizationId: string;
      eventId: string;
      workerId: string;
      checkpointVersion: number;
    }>,
  ): Promise<ProductRelationshipGraphEventCompletion>;
  fail(
    command: Readonly<{
      organizationId: string;
      eventId: string;
      workerId: string;
      checkpointVersion: number;
      errorCode: string;
      retryable: boolean;
    }>,
  ): Promise<ProductRelationshipGraphEventFailure>;
}

export type ProductRelationshipPropagationWorkerCommand = Readonly<{
  organizationId: string;
  sourceReleaseId?: string;
  sourceBaselineRevisionId?: string;
  graphVersion: number;
  asOf?: string;
  cursor?: string;
  pageSize?: number;
}>;

/**
 * System-only relationship traversal. Unlike the interactive resolver, this
 * port does not depend on the user who caused a durable graph change still
 * being an active member when a worker resumes the job.
 */
export interface ProductRelationshipPropagationWorkerPort {
  getCandidatePage(
    command: ProductRelationshipPropagationWorkerCommand,
  ): Promise<
    | Readonly<{
        outcome: "found";
        candidates: readonly RelationshipPropagationCandidate[];
        nextCursor: string | null;
        graphVersion: number;
        evaluatedAt: string;
      }>
    | Readonly<{
        outcome: "conflict" | "not_found" | "invalid_request";
      }>
  >;
}

export const PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER = Symbol(
  "PRODUCT_RELATIONSHIP_GRAPH_EVENT_WORKER",
);
export const PRODUCT_RELATIONSHIP_PROPAGATION_WORKER = Symbol(
  "PRODUCT_RELATIONSHIP_PROPAGATION_WORKER",
);
