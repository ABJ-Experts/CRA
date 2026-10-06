import { describe, expect, it } from "vitest";

import {
  MutationRequestIdentity,
  mutationIdentityHeaders,
} from "./mutation-request-identity";

describe("MutationRequestIdentity", () => {
  it("reuses one request identity for an explicit retry of the same action", () => {
    const identity = new MutationRequestIdentity();
    const first = identity.forAction("role:member-1:admin");

    expect(identity.forAction("role:member-1:admin")).toEqual(first);
    expect(first.idempotencyKey).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
    );
    expect(first.correlationId).toBe(first.idempotencyKey);
  });

  it("creates a new identity after a changed action or confirmed success", () => {
    const identity = new MutationRequestIdentity();
    const first = identity.forAction("role:member-1:admin");
    const changed = identity.forAction("role:member-1:viewer");

    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
    identity.clear();
    expect(identity.forAction("role:member-1:viewer").idempotencyKey).not.toBe(
      changed.idempotencyKey,
    );
  });

  it("rejects malformed request IDs before they reach the transport", () => {
    expect(
      mutationIdentityHeaders({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        correlationId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({
      "idempotency-key": "11111111-1111-4111-8111-111111111111",
      "x-correlation-id": "22222222-2222-4222-8222-222222222222",
    });
    expect(() =>
      mutationIdentityHeaders({
        idempotencyKey: "not-a-uuid",
        correlationId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrowError(/Invalid request identity/);
    expect(() =>
      mutationIdentityHeaders({
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        correlationId: "not-a-uuid",
      }),
    ).toThrowError(/Invalid request identity/);
  });
});
