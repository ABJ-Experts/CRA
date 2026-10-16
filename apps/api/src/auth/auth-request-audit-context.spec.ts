import { authRequestAuditContext } from "./auth-request-audit-context";

describe("auth request audit context", () => {
  it("takes source IP from Express trust policy, never a raw forwarded header", () => {
    const context = authRequestAuditContext({
      ip: "127.0.0.1",
      headers: {
        "x-forwarded-for": "203.0.113.77",
        "x-correlation-id": "invalid-id",
        "user-agent": "test browser",
      },
    } as never);
    expect(context).toEqual({
      ipAddress: "127.0.0.1",
      correlationId: "invalid-id",
      userAgent: "test browser",
    });
    expect(context.ipAddress).not.toBe("203.0.113.77");
  });

  it("omits absent or multi-valued untrusted headers", () => {
    expect(
      authRequestAuditContext({
        headers: { "x-correlation-id": ["one", "two"] },
      } as never),
    ).toEqual({ correlationId: undefined, ipAddress: null, userAgent: null });
  });
});
