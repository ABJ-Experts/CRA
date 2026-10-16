import {
  AuthSecurityAudit,
  AuthAuditUnavailableError,
} from "./auth-security-audit";

const ACTOR_ID = "b4335932-2d51-4225-9137-3f46de64f00e";
const ID = "a2794048-758a-4be5-ac04-17239f4a3677";

describe("AuthSecurityAudit", () => {
  it("writes an intent before a critical provider action and a distinct outcome", async () => {
    const recordV2 = jest
      .fn()
      .mockResolvedValue({ outcome: "inserted", auditId: ID });
    const audit = new AuthSecurityAudit({ recordV2 }, () => ID);
    const attempt = await audit.beginCritical("auth.mfa_unenroll", ACTOR_ID, {
      correlationId: "not-a-uuid",
      ipAddress: "127.0.0.1",
      userAgent: "test browser",
    });
    await audit.finishCritical(attempt, "completed", null);

    expect(recordV2).toHaveBeenCalledTimes(2);
    expect(recordV2).toHaveBeenNthCalledWith(
      1,
      null,
      expect.objectContaining({
        organizationId: null,
        scope: "security",
        eventKey: `auth.mfa_unenroll:${ID}:intent`,
        actorType: "user",
        actorId: ACTOR_ID,
        userId: null,
        outcome: "intent",
        correlationId: ID,
        beforeRedacted: null,
        afterRedacted: null,
        ipAddress: "127.0.0.1",
      }),
    );
    expect(recordV2).toHaveBeenNthCalledWith(
      2,
      null,
      expect.objectContaining({
        eventKey: `auth.mfa_unenroll:${ID}:completed`,
        outcome: "completed",
      }),
    );
    expect(JSON.stringify(recordV2.mock.calls)).not.toContain("password");
  });

  it("fails closed before critical provider work when intent cannot be saved", async () => {
    const recordV2 = jest.fn().mockRejectedValue(new Error("database offline"));
    const audit = new AuthSecurityAudit({ recordV2 }, () => ID);
    await expect(
      audit.beginCritical("auth.sign_up", ACTOR_ID),
    ).rejects.toBeInstanceOf(AuthAuditUnavailableError);
  });

  it("links a completed pre-tenant registration to its resolved stable actor", async () => {
    const recordV2 = jest
      .fn()
      .mockResolvedValue({ outcome: "inserted", auditId: ID });
    const audit = new AuthSecurityAudit({ recordV2 }, () => ID);
    const attempt = await audit.beginCritical("auth.sign_up", null);
    await audit.finishCritical(attempt, "completed", null, ACTOR_ID);
    expect(recordV2).toHaveBeenNthCalledWith(
      1,
      null,
      expect.objectContaining({
        actorType: "system",
        actorId: "anonymous",
        userId: null,
      }),
    );
    expect(recordV2).toHaveBeenNthCalledWith(
      2,
      null,
      expect.objectContaining({
        actorType: "user",
        actorId: ACTOR_ID,
        userId: null,
      }),
    );
  });

  it("keeps availability-preserving sign-in and refresh events best effort", async () => {
    const recordV2 = jest.fn().mockRejectedValue(new Error("database offline"));
    const audit = new AuthSecurityAudit({ recordV2 }, () => ID);
    await expect(
      audit.recordBestEffort(
        "auth.sign_in",
        "denied",
        null,
        undefined,
        "invalid_credentials",
      ),
    ).resolves.toBe(false);
    expect(recordV2).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        actorType: "system",
        actorId: "anonymous",
        userId: null,
        outcome: "denied",
        reason: "invalid_credentials",
      }),
    );
  });

  it("accepts a valid correlation, rejects unsafe IPs and caps user agents", async () => {
    const recordV2 = jest
      .fn()
      .mockResolvedValue({ outcome: "replayed", auditId: ID });
    const audit = new AuthSecurityAudit({ recordV2 }, () => ID);
    await expect(
      audit.recordBestEffort("auth.refresh", "completed", null, {
        correlationId: ACTOR_ID,
        ipAddress: "203.0.113.1 injected",
        userAgent: "a".repeat(600),
      }),
    ).resolves.toBe(true);
    expect(recordV2).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        correlationId: ACTOR_ID,
        ipAddress: null,
        userAgent: "a".repeat(512),
      }),
    );
  });

  it("rejects an identity collision before provider work and degrades noncritical writes", async () => {
    const recordV2 = jest
      .fn()
      .mockResolvedValue({ outcome: "conflict", auditId: ID });
    const audit = new AuthSecurityAudit({ recordV2 }, () => ID);
    await expect(
      audit.beginCritical("auth.mfa_enroll", ACTOR_ID),
    ).rejects.toBeInstanceOf(AuthAuditUnavailableError);
    await expect(
      audit.recordBestEffort("auth.sign_in", "failed", null),
    ).resolves.toBe(false);
  });
});
