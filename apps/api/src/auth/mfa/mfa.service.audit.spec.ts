import { MfaService } from "./mfa.service";

const ID = "b4335932-2d51-4225-9137-3f46de64f00e";
const success = (value: unknown) => ({
  execute: jest.fn().mockResolvedValue({ ok: true, value }),
});

describe("MfaService audit orchestration", () => {
  const recoveryService = (audit: object, recover = success(undefined)) => ({
    recover,
    service: new MfaService(
      ...([
        success({ factorId: "f", qrCode: "q", secret: "s", uri: "u" }),
        success({
          recoveryCodes: [],
          tokens: { accessToken: "a", refreshToken: "r" },
        }),
        success({ accessToken: "a", refreshToken: "r" }),
        recover,
        success(true),
        success(undefined),
        audit,
      ] as unknown as ConstructorParameters<typeof MfaService>),
    ),
  });

  it("persists intent before changing provider factors", async () => {
    const unenroll = success(undefined);
    const audit = {
      beginCritical: jest.fn().mockRejectedValue(new Error("database down")),
      finishCritical: jest.fn(),
    };
    const service = new MfaService(
      ...([
        success({ factorId: "f", qrCode: "q", secret: "s", uri: "u" }),
        success({
          recoveryCodes: [],
          tokens: { accessToken: "a", refreshToken: "r" },
        }),
        success({ accessToken: "a", refreshToken: "r" }),
        success(undefined),
        success(true),
        unenroll,
        audit,
      ] as unknown as ConstructorParameters<typeof MfaService>),
    );
    await expect(
      service.unenroll("raw-token", ID, "factor"),
    ).rejects.toMatchObject({ status: 503 });
    expect(unenroll.execute).not.toHaveBeenCalled();
  });

  it("does not consume a recovery code or remove factors without a durable intent", async () => {
    const audit = {
      beginCritical: jest
        .fn()
        .mockRejectedValue(new Error("audit unavailable")),
      finishCritical: jest.fn(),
    };
    const { recover, service } = recoveryService(audit);
    await expect(
      service.redeemRecoveryCode(ID, ID, "secret-recovery-code", {
        ipAddress: "127.0.0.1",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(recover.execute).not.toHaveBeenCalled();
    expect(audit.beginCritical).toHaveBeenCalledWith("auth.mfa_recovery", ID, {
      ipAddress: "127.0.0.1",
    });
    expect(JSON.stringify(audit.beginCritical.mock.calls)).not.toContain(
      "secret-recovery-code",
    );
  });

  it("records a provider-backed recovery outcome without replaying an uncertain acceptance", async () => {
    const audit = {
      beginCritical: jest.fn().mockResolvedValue({ operationId: "operation" }),
      finishCritical: jest
        .fn()
        .mockRejectedValue(new Error("outcome unavailable")),
    };
    const { recover, service } = recoveryService(audit);
    await expect(
      service.redeemRecoveryCode(ID, ID, "secret-recovery-code"),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: "audit_outcome_uncertain" },
    });
    expect(recover.execute).toHaveBeenCalledTimes(1);
    expect(audit.beginCritical.mock.invocationCallOrder[0]).toBeLessThan(
      recover.execute.mock.invocationCallOrder[0]!,
    );
    expect(recover.execute.mock.invocationCallOrder[0]).toBeLessThan(
      audit.finishCritical.mock.invocationCallOrder[0]!,
    );
    expect(audit.finishCritical).toHaveBeenCalledWith(
      { operationId: "operation" },
      "completed",
      null,
    );
    expect(JSON.stringify(audit.finishCritical.mock.calls)).not.toContain(
      "secret-recovery-code",
    );
  });

  it("keeps the intent unresolved after a possible provider side effect", async () => {
    const audit = {
      beginCritical: jest.fn().mockResolvedValue({ operationId: "operation" }),
      finishCritical: jest.fn(),
    };
    const recover = {
      execute: jest.fn().mockResolvedValue({
        ok: false,
        error: { code: "mfa_recovery_uncertain" },
      }),
    };
    const { service } = recoveryService(audit, recover);
    await expect(
      service.redeemRecoveryCode(ID, ID, "secret-recovery-code"),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: "audit_outcome_uncertain" },
    });
    expect(audit.finishCritical).not.toHaveBeenCalled();
    expect(JSON.stringify(audit.beginCritical.mock.calls)).not.toContain(
      "secret-recovery-code",
    );
  });
});
