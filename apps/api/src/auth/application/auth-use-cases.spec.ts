import { createHash } from "node:crypto";

import type { AuthIdentityProvider } from "./auth-identity-provider.port";
import type { AuthProfileRepository } from "./auth-profile-repository.port";
import {
  ManageEmailVerificationUseCase,
  ManagePasswordRecoveryUseCase,
  RecoverMfaUseCase,
} from "./auth-use-cases";
import type { MfaRecoveryRepository } from "./mfa-recovery-repository.port";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_USER_ID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = "33333333-3333-4333-8333-333333333333";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hasher = Object.freeze({ hash });

function profileRepository(
  overrides: Partial<AuthProfileRepository> = {},
): AuthProfileRepository {
  return {
    verifyEmailCode: jest.fn().mockResolvedValue("verified"),
    consumePasswordReset: jest.fn().mockResolvedValue({
      outcome: "consumed",
      userId: USER_ID,
      authUserId: AUTH_USER_ID,
    }),
    ...overrides,
  };
}

function identityProvider(
  overrides: Partial<AuthIdentityProvider> = {},
): AuthIdentityProvider {
  return {
    updatePassword: jest.fn().mockResolvedValue(undefined),
    listMfaFactors: jest.fn().mockResolvedValue([]),
    deleteMfaFactor: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function recoveryRepository(
  overrides: Partial<MfaRecoveryRepository> = {},
): MfaRecoveryRepository {
  return {
    claim: jest.fn().mockResolvedValue({
      outcome: "claimed",
      operationId: OPERATION_ID,
      authUserId: AUTH_USER_ID,
      status: "claimed",
    }),
    status: jest.fn().mockResolvedValue("completed"),
    markFactorsRemoved: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ManageEmailVerificationUseCase", () => {
  it("hashes the raw code before the atomic repository call", async () => {
    const repository = profileRepository();
    const useCase = new ManageEmailVerificationUseCase(repository, hasher, 5);

    const result = await useCase.execute({ userId: USER_ID, code: "123456" });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(Object.isFrozen(result)).toBe(true);
    expect(repository.verifyEmailCode).toHaveBeenCalledWith(
      USER_ID,
      hash("123456"),
      5,
    );
    expect(
      JSON.stringify(jest.mocked(repository.verifyEmailCode).mock.calls),
    ).not.toContain("123456");
  });

  it.each([
    ["missing", "otp_missing"],
    ["expired", "otp_expired"],
    ["attempts_exhausted", "otp_attempts_exhausted"],
    ["invalid", "otp_invalid"],
  ] as const)(
    "maps %s without inventing transport errors",
    async (outcome, code) => {
      const repository = profileRepository({
        verifyEmailCode: jest.fn().mockResolvedValue(outcome),
      });

      await expect(
        new ManageEmailVerificationUseCase(repository, hasher, 5).execute({
          userId: USER_ID,
          code: "123456",
        }),
      ).resolves.toEqual({ ok: false, error: { code } });
    },
  );

  it("fails closed when the atomic repository is unavailable", async () => {
    const repository = profileRepository({
      verifyEmailCode: jest.fn().mockRejectedValue(new Error("db body")),
    });

    const result = await new ManageEmailVerificationUseCase(
      repository,
      hasher,
      5,
    ).execute({
      userId: USER_ID,
      code: "123456",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "email_verification_failed" },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.ok ? undefined : result.error)).toBe(true);
  });
});

describe("ManagePasswordRecoveryUseCase", () => {
  it("consumes only the token hash before updating the provider password", async () => {
    const repository = profileRepository();
    const identity = identityProvider();
    const useCase = new ManagePasswordRecoveryUseCase(
      repository,
      identity,
      hasher,
    );

    await expect(
      useCase.execute({ token: "raw-token", password: "NewPassword123!" }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.consumePasswordReset).toHaveBeenCalledWith(
      hash("raw-token"),
    );
    expect(identity.updatePassword).toHaveBeenCalledWith(
      AUTH_USER_ID,
      "NewPassword123!",
    );
    expect(
      jest.mocked(repository.consumePasswordReset).mock.invocationCallOrder[0],
    ).toBeLessThan(
      jest.mocked(identity.updatePassword).mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["invalid", "reset_token_invalid"],
    ["profile_missing", "reset_token_invalid"],
    ["expired", "reset_token_expired"],
  ] as const)("does not call the provider for %s", async (outcome, code) => {
    const identity = identityProvider();
    const repository = profileRepository({
      consumePasswordReset: jest.fn().mockResolvedValue({ outcome }),
    });

    await expect(
      new ManagePasswordRecoveryUseCase(repository, identity, hasher).execute({
        token: "raw-token",
        password: "NewPassword123!",
      }),
    ).resolves.toEqual({ ok: false, error: { code } });
    expect(identity.updatePassword).not.toHaveBeenCalled();
  });

  it("keeps a claim consumed when the provider update fails", async () => {
    const repository = profileRepository();
    const identity = identityProvider({
      updatePassword: jest.fn().mockRejectedValue(new Error("provider body")),
    });

    await expect(
      new ManagePasswordRecoveryUseCase(repository, identity, hasher).execute({
        token: "raw-token",
        password: "NewPassword123!",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "password_update_failed" },
    });
    expect(repository.consumePasswordReset).toHaveBeenCalledTimes(1);
  });

  it("distinguishes repository outage from post-consumption provider failure", async () => {
    const repository = profileRepository({
      consumePasswordReset: jest.fn().mockRejectedValue(new Error("db body")),
    });
    const identity = identityProvider();

    await expect(
      new ManagePasswordRecoveryUseCase(repository, identity, hasher).execute({
        token: "raw-token",
        password: "NewPassword123!",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "password_reset_unavailable" },
    });
    expect(identity.updatePassword).not.toHaveBeenCalled();
  });
});

describe("RecoverMfaUseCase", () => {
  const delay = Object.freeze({ wait: jest.fn().mockResolvedValue(undefined) });

  it("claims first, removes all factors, persists removal, then completes", async () => {
    const calls: string[] = [];
    const repository = recoveryRepository({
      claim: jest.fn(() => {
        calls.push("claim");
        return Promise.resolve({
          outcome: "claimed" as const,
          operationId: OPERATION_ID,
          authUserId: AUTH_USER_ID,
          status: "claimed" as const,
        });
      }),
      markFactorsRemoved: jest.fn(() => {
        calls.push("mark");
        return Promise.resolve();
      }),
      complete: jest.fn(() => {
        calls.push("complete");
        return Promise.resolve();
      }),
    });
    const identity = identityProvider({
      listMfaFactors: jest.fn(() => {
        calls.push("list");
        return Promise.resolve([{ id: "factor-1" }, { id: "factor-2" }]);
      }),
      deleteMfaFactor: jest.fn((_userId, factorId) => {
        calls.push(`delete:${factorId}`);
        return Promise.resolve();
      }),
    });

    await expect(
      new RecoverMfaUseCase(repository, identity, hasher, delay).execute({
        userId: USER_ID,
        authUserId: AUTH_USER_ID,
        code: "ABCD-EF12",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });

    expect(repository.claim).toHaveBeenCalledWith(USER_ID, hash("abcdef12"));
    expect(calls).toEqual([
      "claim",
      "list",
      "delete:factor-1",
      "delete:factor-2",
      "mark",
      "complete",
    ]);
  });

  it("persists a sanitized failure after a partial provider deletion", async () => {
    const repository = recoveryRepository();
    const identity = identityProvider({
      listMfaFactors: jest
        .fn()
        .mockResolvedValue([{ id: "factor-1" }, { id: "factor-2" }]),
      deleteMfaFactor: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("provider body")),
    });

    await expect(
      new RecoverMfaUseCase(repository, identity, hasher, delay).execute({
        userId: USER_ID,
        authUserId: AUTH_USER_ID,
        code: "ABCD-EF12",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "auth_unavailable" },
    });
    expect(repository.fail).toHaveBeenCalledWith(
      OPERATION_ID,
      USER_ID,
      "delete_factor_failed",
    );
    expect(repository.markFactorsRemoved).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("resumes after failure and skips provider work after factors were removed", async () => {
    const repository = recoveryRepository({
      claim: jest.fn().mockResolvedValue({
        outcome: "resumed",
        operationId: OPERATION_ID,
        authUserId: AUTH_USER_ID,
        status: "factors_removed",
      }),
    });
    const identity = identityProvider();

    await expect(
      new RecoverMfaUseCase(repository, identity, hasher, delay).execute({
        userId: USER_ID,
        authUserId: AUTH_USER_ID,
        code: "ABCD-EF12",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(identity.listMfaFactors).not.toHaveBeenCalled();
    expect(repository.complete).toHaveBeenCalledTimes(1);
  });

  it("coalesces an in-progress replay by polling without provider calls", async () => {
    const repository = recoveryRepository({
      claim: jest.fn().mockResolvedValue({
        outcome: "in_progress",
        operationId: OPERATION_ID,
        authUserId: AUTH_USER_ID,
        status: "claimed",
      }),
      status: jest
        .fn()
        .mockResolvedValueOnce("claimed")
        .mockResolvedValueOnce("completed"),
    });
    const identity = identityProvider();
    const localDelay = Object.freeze({
      wait: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      new RecoverMfaUseCase(
        repository,
        identity,
        hasher,
        localDelay,
        3,
        250,
      ).execute({
        userId: USER_ID,
        authUserId: AUTH_USER_ID,
        code: "ABCD-EF12",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(identity.listMfaFactors).not.toHaveBeenCalled();
    expect(localDelay.wait).toHaveBeenCalledWith(250);
  });

  it("fails closed when the polling delay adapter rejects", async () => {
    const repository = recoveryRepository({
      claim: jest.fn().mockResolvedValue({
        outcome: "in_progress",
        operationId: OPERATION_ID,
        authUserId: AUTH_USER_ID,
        status: "claimed",
      }),
      status: jest.fn().mockResolvedValue("claimed"),
    });
    const failedDelay = Object.freeze({
      wait: jest.fn().mockRejectedValue(new Error("timer unavailable")),
    });

    await expect(
      new RecoverMfaUseCase(
        repository,
        identityProvider(),
        hasher,
        failedDelay,
        2,
        250,
      ).execute({
        userId: USER_ID,
        authUserId: AUTH_USER_ID,
        code: "ABCD-EF12",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "auth_unavailable" },
    });
  });

  it.each([
    ["invalid", { outcome: "invalid" as const }, "mfa_recovery_invalid"],
    [
      "identity mismatch",
      {
        outcome: "claimed" as const,
        operationId: OPERATION_ID,
        authUserId: "44444444-4444-4444-8444-444444444444",
        status: "claimed" as const,
      },
      "auth_unavailable",
    ],
    [
      "completed claim",
      {
        outcome: "resumed" as const,
        operationId: OPERATION_ID,
        authUserId: AUTH_USER_ID,
        status: "completed" as const,
      },
      "auth_unavailable",
    ],
  ])("handles %s conservatively", async (_name, claim, code) => {
    const repository = recoveryRepository({
      claim: jest.fn().mockResolvedValue(claim),
    });

    await expect(
      new RecoverMfaUseCase(
        repository,
        identityProvider(),
        hasher,
        delay,
      ).execute({
        userId: USER_ID,
        authUserId: AUTH_USER_ID,
        code: "ABCD-EF12",
      }),
    ).resolves.toEqual({ ok: false, error: { code } });
  });
});
