import type { AuditEventInput } from "@repo/contracts/audit/types";

import { AuditService } from "./audit.service";

const event: AuditEventInput = {
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
  afterRedacted: {
    reasonCode: "invalid_credentials",
    password: "secret-canary",
  },
  reason: "invalid_credentials",
  ipAddress: "127.0.0.1",
  userAgent: null,
};

describe("AuditService v2", () => {
  it("redacts before sending the event to the atomic append RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "inserted",
          audit_id: "7e23d4ba-1774-442b-9bcd-a39788192185",
        },
      ],
      error: null,
    });
    const service = new AuditService({ admin: () => ({ rpc }) } as never);

    await expect(service.recordV2(null, event)).resolves.toEqual({
      outcome: "inserted",
      auditId: "7e23d4ba-1774-442b-9bcd-a39788192185",
    });
    expect(rpc).toHaveBeenCalledWith(
      "m13_01_append_audit_event",
      expect.objectContaining({
        p_organization_id: null,
        p_scope: "security",
        p_before_redacted: null,
        p_after_redacted: {
          reasonCode: "invalid_credentials",
          password: "[REDACTED]",
        },
      }),
    );
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("secret-canary");
  });

  it("marks audit degraded and rejects a store outage", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: "unavailable" } });
    const service = new AuditService({ admin: () => ({ rpc }) } as never);

    await expect(service.recordV2(null, event)).rejects.toThrow(
      "audit write unavailable",
    );
    await expect(service.isReady()).resolves.toBe(false);
  });

  it("rejects conflicting retries rather than reporting success", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "conflict", audit_id: null }],
      error: null,
    });
    const service = new AuditService({ admin: () => ({ rpc }) } as never);

    await expect(service.recordV2(null, event)).rejects.toThrow(
      "audit event conflict",
    );
  });

  it("rejects a caller scope that differs from the envelope", async () => {
    const rpc = jest.fn();
    const service = new AuditService({ admin: () => ({ rpc }) } as never);

    await expect(
      service.recordV2("7e23d4ba-1774-442b-9bcd-a39788192185", event),
    ).rejects.toThrow("audit organization scope mismatch");
    expect(rpc).not.toHaveBeenCalled();
  });
});
