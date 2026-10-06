import { auditRequestIdSchema } from "@repo/contracts/audit/schemas";

import { ApiClientError } from "./api-client";

export type MutationIdentity = Readonly<{
  idempotencyKey: string;
  correlationId: string;
}>;

/** Holds one user action through an explicit retry without replaying requests. */
export class MutationRequestIdentity {
  private pending: Readonly<{
    action: string;
    identity: MutationIdentity;
  }> | null = null;

  forAction(action: string): MutationIdentity {
    if (this.pending?.action === action) return this.pending.identity;

    const idempotencyKey = crypto.randomUUID();
    const identity = Object.freeze({
      idempotencyKey,
      correlationId: idempotencyKey,
    });
    this.pending = Object.freeze({ action, identity });
    return identity;
  }

  clear(): void {
    this.pending = null;
  }
}

export function mutationIdentityHeaders(identity: MutationIdentity): Readonly<{
  "idempotency-key": string;
  "x-correlation-id": string;
}> {
  const eventKey = auditRequestIdSchema.safeParse(identity.idempotencyKey);
  const correlation = auditRequestIdSchema.safeParse(identity.correlationId);
  if (!eventKey.success || !correlation.success) {
    throw new ApiClientError("invalid_request", "Invalid request identity.");
  }
  return Object.freeze({
    "idempotency-key": eventKey.data,
    "x-correlation-id": correlation.data,
  });
}
