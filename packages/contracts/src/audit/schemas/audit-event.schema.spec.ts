import { describe, expect, it } from "vitest";

import { auditEventInputSchema } from "./audit-event.schema.js";

const event = {
  organizationId: null,
  scope: "security",
  eventKey: "auth:attempt:7e23d4ba-1774-442b-9bcd-a39788192185:failed",
  actorType: "system",
  actorId: "auth",
  userId: null,
  action: "auth.sign_in_failed",
  entityType: "authentication_attempt",
  entityId: "7e23d4ba-1774-442b-9bcd-a39788192185",
  outcome: "failed",
  correlationId: "7e23d4ba-1774-442b-9bcd-a39788192185",
  beforeRedacted: null,
  afterRedacted: { reasonCode: "invalid_credentials" },
  reason: "invalid_credentials",
  ipAddress: "127.0.0.1",
  userAgent: null,
} as const;

describe("auditEventInputSchema", () => {
  it("parses a pre-tenant security event", () => {
    expect(auditEventInputSchema.parse(event)).toEqual(event);
  });

  it("rejects a caller-supplied organization in security scope", () => {
    expect(
      auditEventInputSchema.safeParse({
        ...event,
        organizationId: "7e23d4ba-1774-442b-9bcd-a39788192185",
      }).success,
    ).toBe(false);
  });

  it("requires a verified organization for organization scope", () => {
    expect(
      auditEventInputSchema.safeParse({ ...event, scope: "organization" })
        .success,
    ).toBe(false);
  });

  it("rejects malformed correlation and unknown fields", () => {
    expect(
      auditEventInputSchema.safeParse({ ...event, correlationId: "bad" })
        .success,
    ).toBe(false);
    expect(
      auditEventInputSchema.safeParse({ ...event, password: "canary" }).success,
    ).toBe(false);
    expect(
      auditEventInputSchema.safeParse({ ...event, eventKey: "auth:retry:password" })
        .success,
    ).toBe(false);
  });
});
