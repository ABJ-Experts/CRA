import type { AuthIdentityProvider } from "./auth-identity-provider.port";
import type { AuthProfileRepository } from "./auth-profile-repository.port";
import {
  AuthenticateUserUseCase,
  ConfirmMfaEnrollmentUseCase,
  EnrollMfaUseCase,
  HasVerifiedMfaQuery,
  IssueVerificationArtifactUseCase,
  ReadSessionQuery,
  ReauthenticateUserUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
  SignOutEverywhereUseCase,
  UnenrollMfaUseCase,
  VerifyMfaUseCase,
} from "./auth-use-cases";

const profile = {
  id: "profile-1",
  authUserId: "auth-1",
  email: "user@cra.test",
  username: "user",
  firstName: null,
  lastName: null,
  avatarUrl: null,
  isActive: true,
  emailVerifiedAt: null,
} as const;
const tokens = { accessToken: "access", refreshToken: "refresh" } as const;

const identity = (overrides: Partial<AuthIdentityProvider> = {}) =>
  ({
    register: jest.fn().mockResolvedValue({
      outcome: "created",
      identity: { authUserId: "auth-1", tokens },
    }),
    authenticate: jest.fn().mockResolvedValue({ authUserId: "auth-1", tokens }),
    refresh: jest.fn().mockResolvedValue(tokens),
    signOutGlobally: jest.fn().mockResolvedValue(undefined),
    updatePassword: jest.fn().mockResolvedValue(true),
    listMfaFactors: jest.fn().mockResolvedValue([]),
    deleteMfaFactor: jest.fn().mockResolvedValue(undefined),
    enrollMfa: jest.fn().mockResolvedValue({
      factorId: "factor",
      qrCode: "qr",
      secret: "secret",
      uri: "uri",
    }),
    verifyMfa: jest.fn().mockResolvedValue({ outcome: "verified", tokens }),
    listUserMfaFactors: jest
      .fn()
      .mockResolvedValue([{ id: "factor", status: "verified" }]),
    unenrollMfa: jest.fn().mockResolvedValue(true),
    ...overrides,
  }) satisfies AuthIdentityProvider;

const profiles = (overrides: Partial<AuthProfileRepository> = {}) =>
  ({
    isUsernameTaken: jest.fn().mockResolvedValue(false),
    findByAuthUserId: jest.fn().mockResolvedValue(profile),
    findById: jest.fn().mockResolvedValue(profile),
    findByEmail: jest.fn().mockResolvedValue(profile),
    resolveUsername: jest.fn().mockResolvedValue(null),
    listMemberships: jest.fn().mockResolvedValue([]),
    lockedUntil: jest.fn().mockResolvedValue(null),
    recordLoginFailure: jest.fn().mockResolvedValue(undefined),
    clearLoginFailures: jest.fn().mockResolvedValue(undefined),
    bumpSessionEpoch: jest.fn().mockResolvedValue(undefined),
    supersedeVerification: jest.fn().mockResolvedValue(undefined),
    storeVerification: jest.fn().mockResolvedValue(undefined),
    storePasswordReset: jest.fn().mockResolvedValue(undefined),
    replaceRecoveryCodes: jest.fn().mockResolvedValue(undefined),
    clearRecoveryCodes: jest.fn().mockResolvedValue(undefined),
    verifyEmailCode: jest.fn().mockResolvedValue("verified"),
    consumePasswordReset: jest.fn().mockResolvedValue({ outcome: "invalid" }),
    ...overrides,
  }) satisfies AuthProfileRepository;

describe("primary auth use cases", () => {
  const delay = { wait: jest.fn().mockResolvedValue(undefined) };

  it("registers only after checking the username and requires the trigger profile", async () => {
    const provider = identity();
    const repository = profiles();
    const issue = {
      execute: jest.fn().mockResolvedValue({ ok: true, value: undefined }),
    };
    const result = await new RegisterUserUseCase(
      repository,
      provider,
      issue,
    ).execute({
      email: "user@cra.test",
      username: "user",
      password: "password",
    });
    expect(result).toEqual({
      ok: true,
      value: { tokens, userId: "profile-1" },
    });
    expect(
      jest.mocked(repository.isUsernameTaken).mock.invocationCallOrder[0],
    ).toBeLessThan(jest.mocked(provider.register).mock.invocationCallOrder[0]!);
    expect(issue.execute).toHaveBeenCalledWith({
      userId: "profile-1",
      email: "user@cra.test",
    });
  });

  it("does not call the provider for a taken username", async () => {
    const provider = identity();
    const result = await new RegisterUserUseCase(
      profiles({ isUsernameTaken: jest.fn().mockResolvedValue(true) }),
      provider,
      {} as never,
    ).execute({
      email: "user@cra.test",
      username: "user",
      password: "password",
    });
    expect(result).toEqual({ ok: false, error: { code: "username_taken" } });
    expect(provider.register).not.toHaveBeenCalled();
  });

  it("authenticates through a normalized username lookup, timing floor, profile state, and lockout", async () => {
    const provider = identity();
    const repository = profiles({
      resolveUsername: jest.fn().mockResolvedValue("user@cra.test"),
    });
    const result = await new AuthenticateUserUseCase(
      repository,
      provider,
      delay,
      400,
    ).execute({ identifier: " USER ", password: "password" });
    expect(result).toEqual({
      ok: true,
      value: { tokens, userId: "profile-1", emailVerified: false },
    });
    expect(provider.authenticate).toHaveBeenCalledWith(
      "user@cra.test",
      "password",
    );
    expect(repository.clearLoginFailures).toHaveBeenCalledWith("user@cra.test");
    expect(delay.wait).toHaveBeenCalledWith(400);
  });

  it("records invalid authentication without leaking account state", async () => {
    const repository = profiles();
    const result = await new AuthenticateUserUseCase(
      repository,
      identity({ authenticate: jest.fn().mockResolvedValue(null) }),
      delay,
    ).execute({ identifier: "USER@CRA.TEST", password: "wrong" });
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid_credentials" },
    });
    expect(repository.recordLoginFailure).toHaveBeenCalledWith(
      "user@cra.test",
      5,
      15,
    );
  });

  it("does not record a login failure during an identity-provider outage", async () => {
    const repository = profiles();
    const provider = identity({
      authenticate: jest
        .fn()
        .mockRejectedValue(new Error("auth identity provider unavailable")),
    });

    await expect(
      new AuthenticateUserUseCase(repository, provider, delay).execute({
        identifier: "user@cra.test",
        password: "password",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
    await expect(
      new ReauthenticateUserUseCase(repository, provider, delay).execute({
        email: "user@cra.test",
        password: "password",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
    expect(repository.recordLoginFailure).not.toHaveBeenCalled();
  });

  it("refreshes and fails closed for an invalid refresh token", async () => {
    await expect(
      new RefreshSessionUseCase(identity()).execute({ refreshToken: "raw" }),
    ).resolves.toEqual({ ok: true, value: tokens });
    await expect(
      new RefreshSessionUseCase(
        identity({ refresh: jest.fn().mockResolvedValue(null) }),
      ).execute({ refreshToken: "raw" }),
    ).resolves.toEqual({ ok: false, error: { code: "refresh_failed" } });
    await expect(
      new RefreshSessionUseCase(
        identity({
          refresh: jest
            .fn()
            .mockRejectedValue(new Error("auth identity provider unavailable")),
        }),
      ).execute({ refreshToken: "raw" }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
  });

  it("bumps the epoch even when global provider sign-out fails", async () => {
    const repository = profiles();
    await expect(
      new SignOutEverywhereUseCase(
        identity({
          signOutGlobally: jest.fn().mockRejectedValue(new Error("provider")),
        }),
        repository,
      ).execute({ userId: "profile-1", accessToken: "raw" }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.bumpSessionEpoch).toHaveBeenCalledWith("profile-1");
  });

  it("projects the selected organization without mutable provider rows", async () => {
    const repository = profiles({
      listMemberships: jest.fn().mockResolvedValue([
        {
          role: "member",
          organization: { id: "org-1", name: "CRA", slug: "cra" },
        },
      ]),
    });
    const result = await new ReadSessionQuery(repository).execute({
      userId: "profile-1",
      organizationId: "org-1",
    });
    expect(result.ok && result.value.organization?.id).toBe("org-1");
    expect(result.ok && Object.isFrozen(result.value.organizations)).toBe(true);
  });

  it("reauthenticates with the timing floor and records failures", async () => {
    const repository = profiles();
    await expect(
      new ReauthenticateUserUseCase(
        repository,
        identity({ authenticate: jest.fn().mockResolvedValue(null) }),
        delay,
        300,
      ).execute({ email: "USER@CRA.TEST", password: "wrong" }),
    ).resolves.toEqual({ ok: true, value: false });
    expect(repository.recordLoginFailure).toHaveBeenCalledWith(
      "user@cra.test",
      5,
      15,
    );
  });

  it("enrolls, verifies, and unenrolls MFA through user-scoped identity operations", async () => {
    const provider = identity();
    const repository = profiles();
    const audit = { log: jest.fn() };
    await expect(
      new EnrollMfaUseCase(provider).execute({ accessToken: "raw" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      new VerifyMfaUseCase(provider, audit).execute({
        accessToken: "raw",
        userId: "profile-1",
        code: "123456",
      }),
    ).resolves.toEqual({ ok: true, value: tokens });
    await expect(
      new UnenrollMfaUseCase(provider, repository, audit).execute({
        accessToken: "raw",
        userId: "profile-1",
        factorId: "factor",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.clearRecoveryCodes).toHaveBeenCalledWith("profile-1");
  });

  it("issues only a hash-backed verification artifact before notifying", async () => {
    const repository = profiles();
    const notifier = {
      sendVerificationCode: jest.fn(),
      sendPasswordReset: jest.fn(),
    };
    const useCase = new IssueVerificationArtifactUseCase(
      repository,
      { hash: (value) => `hash:${value}` },
      {
        otp: () => "123456",
        token: () => "token",
        recoveryCode: () => "abcdef12",
      },
      { now: () => new Date("2026-08-09T00:00:00.000Z") },
      notifier,
      10,
    );
    await expect(
      useCase.execute({ userId: "profile-1", email: "user@cra.test" }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.storeVerification).toHaveBeenCalledWith({
      userId: "profile-1",
      email: "user@cra.test",
      codeHash: "hash:123456",
      expiresAt: "2026-08-09T00:10:00.000Z",
    });
    expect(repository.storeVerification).not.toHaveBeenCalledWith(
      expect.objectContaining({ codeHash: "123456" }),
    );
    expect(notifier.sendVerificationCode).toHaveBeenCalledWith(
      "user@cra.test",
      "123456",
    );
  });

  it("does not notify when verification storage fails", async () => {
    const notifier = {
      sendVerificationCode: jest.fn(),
      sendPasswordReset: jest.fn(),
    };
    const useCase = new IssueVerificationArtifactUseCase(
      profiles({
        storeVerification: jest.fn().mockRejectedValue(new Error("db")),
      }),
      { hash: (value) => value },
      {
        otp: () => "123456",
        token: () => "token",
        recoveryCode: () => "abcdef12",
      },
      { now: () => new Date(0) },
      notifier,
      10,
    );
    await expect(
      useCase.execute({ userId: "profile-1", email: "user@cra.test" }),
    ).resolves.toEqual({ ok: false, error: { code: "otp_store_failed" } });
    expect(notifier.sendVerificationCode).not.toHaveBeenCalled();
  });

  it("keeps password-reset requests uniform for active, missing, and failing profiles", async () => {
    const notifier = {
      sendVerificationCode: jest.fn(),
      sendPasswordReset: jest.fn(),
    };
    const random = {
      otp: () => "123456",
      token: () => "raw-token",
      recoveryCode: () => "abcdef12",
    };
    const repository = profiles();
    const useCase = new RequestPasswordResetUseCase(
      repository,
      { hash: (value) => `hash:${value}` },
      random,
      { now: () => new Date("2026-08-09T00:00:00.000Z") },
      notifier,
      delay,
      20,
      300,
    );
    await expect(
      useCase.execute({ email: " USER@CRA.TEST " }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(repository.storePasswordReset).toHaveBeenCalledWith({
      userId: "profile-1",
      tokenHash: "hash:raw-token",
      expiresAt: "2026-08-09T00:20:00.000Z",
    });
    expect(notifier.sendPasswordReset).toHaveBeenCalledWith(
      "user@cra.test",
      "raw-token",
    );
    await expect(
      new RequestPasswordResetUseCase(
        profiles({ findByEmail: jest.fn().mockRejectedValue(new Error("db")) }),
        { hash: (value) => value },
        random,
        { now: () => new Date(0) },
        notifier,
        delay,
        20,
      ).execute({ email: "missing@cra.test" }),
    ).resolves.toEqual({ ok: true, value: undefined });
  });

  it.each([
    [{ outcome: "email_taken" }, "email_taken"],
    [{ outcome: "failed" }, "signup_failed"],
  ] as const)(
    "maps registration provider outcome",
    async (providerResult, code) => {
      const result = await new RegisterUserUseCase(
        profiles(),
        identity({ register: jest.fn().mockResolvedValue(providerResult) }),
        {} as never,
      ).execute({
        email: "user@cra.test",
        username: "user",
        password: "password",
      });
      expect(result).toEqual({ ok: false, error: { code } });
    },
  );

  it("maps registration transport failures to auth_unavailable", async () => {
    await expect(
      new RegisterUserUseCase(
        profiles(),
        identity({
          register: jest
            .fn()
            .mockRejectedValue(new Error("auth identity provider unavailable")),
        }),
        {} as never,
      ).execute({
        email: "user@cra.test",
        username: "user",
        password: "password",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
  });

  it("fails registration when the trigger profile or verification artifact is missing", async () => {
    const missing = await new RegisterUserUseCase(
      profiles({ findByAuthUserId: jest.fn().mockResolvedValue(null) }),
      identity(),
      {} as never,
    ).execute({
      email: "user@cra.test",
      username: "user",
      password: "password",
    });
    expect(missing).toEqual({ ok: false, error: { code: "profile_missing" } });
    const issue = {
      execute: jest
        .fn()
        .mockResolvedValue({ ok: false, error: { code: "otp_store_failed" } }),
    };
    await expect(
      new RegisterUserUseCase(profiles(), identity(), issue as never).execute({
        email: "user@cra.test",
        username: "user",
        password: "password",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "otp_store_failed" } });
  });

  it("fails authentication for locked and inactive profiles", async () => {
    await expect(
      new AuthenticateUserUseCase(
        profiles({ lockedUntil: jest.fn().mockResolvedValue("future") }),
        identity(),
        delay,
      ).execute({ identifier: "user@cra.test", password: "password" }),
    ).resolves.toEqual({ ok: false, error: { code: "account_locked" } });
    const repository = profiles({
      findByAuthUserId: jest
        .fn()
        .mockResolvedValue({ ...profile, isActive: false }),
    });
    await expect(
      new AuthenticateUserUseCase(repository, identity(), delay).execute({
        identifier: "user@cra.test",
        password: "password",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "invalid_credentials" } });
    expect(repository.recordLoginFailure).toHaveBeenCalled();
  });

  it("fails closed when epoch revocation or session lookup fails", async () => {
    await expect(
      new SignOutEverywhereUseCase(
        identity(),
        profiles({
          bumpSessionEpoch: jest.fn().mockRejectedValue(new Error("db")),
        }),
      ).execute({ userId: "profile-1", accessToken: "raw" }),
    ).resolves.toEqual({ ok: false, error: { code: "revoke_failed" } });
    await expect(
      new ReadSessionQuery(
        profiles({ findById: jest.fn().mockResolvedValue(null) }),
      ).execute({ userId: "profile-1", organizationId: null }),
    ).resolves.toEqual({ ok: false, error: { code: "profile_missing" } });
    await expect(
      new ReauthenticateUserUseCase(
        profiles({ lockedUntil: jest.fn().mockResolvedValue("future") }),
        identity(),
        delay,
      ).execute({ email: "user@cra.test", password: "password" }),
    ).resolves.toEqual({ ok: false, error: { code: "account_locked" } });
  });

  it("maps every MFA provider failure conservatively", async () => {
    await expect(
      new EnrollMfaUseCase(
        identity({
          enrollMfa: jest.fn().mockResolvedValue(null) as never,
        }),
      ).execute({ accessToken: "raw" }),
    ).resolves.toEqual({ ok: false, error: { code: "mfa_enroll_failed" } });
    const audit = { log: jest.fn() };
    for (const outcome of ["challenge_failed", "invalid"] as const) {
      const result = await new ConfirmMfaEnrollmentUseCase(
        identity({ verifyMfa: jest.fn().mockResolvedValue({ outcome }) }),
        profiles(),
        { hash: (v) => v },
        { otp: () => "", token: () => "", recoveryCode: () => "abcdef12" },
        audit,
      ).execute({
        accessToken: "raw",
        userId: "profile-1",
        factorId: "factor",
        code: "123456",
      });
      expect(result.ok).toBe(false);
    }
    await expect(
      new VerifyMfaUseCase(
        identity({
          listUserMfaFactors: jest.fn().mockResolvedValue(null) as never,
        }),
        audit,
      ).execute({ accessToken: "raw", userId: "profile-1", code: "123456" }),
    ).resolves.toEqual({ ok: false, error: { code: "mfa_factors_failed" } });
    await expect(
      new VerifyMfaUseCase(
        identity({ listUserMfaFactors: jest.fn().mockResolvedValue([]) }),
        audit,
      ).execute({ accessToken: "raw", userId: "profile-1", code: "123456" }),
    ).resolves.toEqual({ ok: false, error: { code: "mfa_not_enrolled" } });
    await expect(
      new HasVerifiedMfaQuery(
        identity({
          listUserMfaFactors: jest.fn().mockResolvedValue(null) as never,
        }),
      ).execute({ accessToken: "raw" }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
    await expect(
      new UnenrollMfaUseCase(
        identity({
          unenrollMfa: jest.fn().mockResolvedValue(false) as never,
        }),
        profiles(),
        audit,
      ).execute({
        accessToken: "raw",
        userId: "profile-1",
        factorId: "factor",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "mfa_unenroll_failed" } });
  });

  it("maps MFA transport failures to auth_unavailable", async () => {
    const unavailable = jest
      .fn()
      .mockRejectedValue(new Error("auth identity provider unavailable"));
    const audit = { log: jest.fn() };

    await expect(
      new EnrollMfaUseCase(identity({ enrollMfa: unavailable })).execute({
        accessToken: "raw",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
    await expect(
      new ConfirmMfaEnrollmentUseCase(
        identity({ verifyMfa: unavailable }),
        profiles(),
        { hash: (v) => v },
        { otp: () => "", token: () => "", recoveryCode: () => "abcdef12" },
        audit,
      ).execute({
        accessToken: "raw",
        userId: "profile-1",
        factorId: "factor",
        code: "123456",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
    await expect(
      new VerifyMfaUseCase(
        identity({ listUserMfaFactors: unavailable }),
        audit,
      ).execute({ accessToken: "raw", userId: "profile-1", code: "123456" }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
    await expect(
      new VerifyMfaUseCase(
        identity({
          verifyMfa: unavailable,
        }),
        audit,
      ).execute({ accessToken: "raw", userId: "profile-1", code: "123456" }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
    await expect(
      new UnenrollMfaUseCase(
        identity({ unenrollMfa: unavailable }),
        profiles(),
        audit,
      ).execute({
        accessToken: "raw",
        userId: "profile-1",
        factorId: "factor",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
  });

  it("fails closed when lockout RPC state cannot be read or updated", async () => {
    await expect(
      new AuthenticateUserUseCase(
        profiles({
          lockedUntil: jest
            .fn()
            .mockRejectedValue(
              new Error("auth profile repository unavailable"),
            ),
        }),
        identity(),
        delay,
      ).execute({ identifier: "user@cra.test", password: "password" }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });

    await expect(
      new AuthenticateUserUseCase(
        profiles({
          clearLoginFailures: jest
            .fn()
            .mockRejectedValue(
              new Error("auth profile repository unavailable"),
            ),
        }),
        identity(),
        delay,
      ).execute({ identifier: "user@cra.test", password: "password" }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });

    const invalidRepository = profiles({
      recordLoginFailure: jest
        .fn()
        .mockRejectedValue(new Error("auth profile repository unavailable")),
    });
    await expect(
      new AuthenticateUserUseCase(
        invalidRepository,
        identity({ authenticate: jest.fn().mockResolvedValue(null) }),
        delay,
      ).execute({ identifier: "user@cra.test", password: "wrong" }),
    ).resolves.toEqual({ ok: false, error: { code: "auth_unavailable" } });
    expect(invalidRepository.recordLoginFailure).toHaveBeenCalledWith(
      "user@cra.test",
      5,
      15,
    );
  });

  it("issues hashed recovery codes only after MFA verification", async () => {
    const repository = profiles();
    const audit = { log: jest.fn() };
    const result = await new ConfirmMfaEnrollmentUseCase(
      identity(),
      repository,
      { hash: (v) => `hash:${v}` },
      { otp: () => "", token: () => "", recoveryCode: () => "abcdef12" },
      audit,
      2,
    ).execute({
      accessToken: "raw",
      userId: "profile-1",
      factorId: "factor",
      code: "123456",
    });
    expect(result).toEqual({
      ok: true,
      value: { recoveryCodes: ["abcd-ef12", "abcd-ef12"], tokens },
    });
    expect(repository.replaceRecoveryCodes).toHaveBeenCalledWith("profile-1", [
      "hash:abcdef12",
      "hash:abcdef12",
    ]);
    await expect(
      new ConfirmMfaEnrollmentUseCase(
        identity(),
        profiles({
          replaceRecoveryCodes: jest.fn().mockRejectedValue(new Error("db")),
        }),
        { hash: (v) => v },
        { otp: () => "", token: () => "", recoveryCode: () => "abcdef12" },
        audit,
        1,
      ).execute({
        accessToken: "raw",
        userId: "profile-1",
        factorId: "factor",
        code: "123456",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "mfa_recovery_generate_failed" },
    });
  });
});
