import { SupabaseAuthIdentityAdapter } from "./supabase-auth-identity.adapter";
import { SupabaseAuthProfileRepository } from "./supabase-auth-profile.repository";
import {
  NodeAuthRandomAdapter,
  NodeSecretHashAdapter,
  SystemClockAdapter,
} from "./node-auth-runtime.adapter";

const session = { access_token: "access", refresh_token: "refresh" };

describe("Node auth runtime", () => {
  it("creates cryptographic artifacts, hashes, and current clock values", () => {
    const random = new NodeAuthRandomAdapter();
    expect(random.otp()).toMatch(/^\d{6}$/);
    expect(random.token()).toMatch(/^[a-f0-9]{64}$/);
    expect(random.recoveryCode()).toMatch(/^[a-f0-9]{8}$/);
    expect(new NodeSecretHashAdapter().hash("secret")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(new SystemClockAdapter().now()).toBeInstanceOf(Date);
  });
});

describe("primary Supabase auth identity operations", () => {
  it("uses a fresh anonymous client for registration, authentication, and refresh", async () => {
    const signUp = jest.fn().mockResolvedValue({
      data: { session, user: { id: "auth-1" } },
      error: null,
    });
    const signInWithPassword = jest.fn().mockResolvedValue({
      data: { session, user: { id: "auth-1" } },
      error: null,
    });
    const refreshSession = jest
      .fn()
      .mockResolvedValue({ data: { session }, error: null });
    const anon = jest.fn(() => ({
      auth: { signUp, signInWithPassword, refreshSession },
    }));
    const adapter = new SupabaseAuthIdentityAdapter({ anon } as never);
    await expect(
      adapter.register("u@cra.test", "password", "user"),
    ).resolves.toMatchObject({ outcome: "created" });
    await expect(
      adapter.authenticate("u@cra.test", "password"),
    ).resolves.toMatchObject({ authUserId: "auth-1" });
    await expect(adapter.refresh("raw-refresh")).resolves.toEqual({
      accessToken: "access",
      refreshToken: "refresh",
    });
    expect(anon).toHaveBeenCalledTimes(3);
  });

  it("maps returned registration and credential failures", async () => {
    const create = (message: string) =>
      new SupabaseAuthIdentityAdapter({
        anon: () => ({
          auth: {
            signUp: jest
              .fn()
              .mockResolvedValue({ data: {}, error: { message } }),
            signInWithPassword: jest
              .fn()
              .mockResolvedValue({ data: {}, error: { message: "secret" } }),
            refreshSession: jest
              .fn()
              .mockResolvedValue({ data: {}, error: { message: "secret" } }),
          },
        }),
      } as never);
    await expect(
      create("already registered").register("u@cra.test", "password", "user"),
    ).resolves.toEqual({ outcome: "email_taken" });
    await expect(
      create("provider secret").register("u@cra.test", "password", "user"),
    ).resolves.toEqual({ outcome: "failed" });
    await expect(
      create("provider secret").authenticate("u@cra.test", "password"),
    ).resolves.toBeNull();
    await expect(create("provider secret").refresh("raw")).resolves.toBeNull();
  });

  it("rejects sanitized transport failures instead of treating credentials as invalid", async () => {
    const rejected = jest.fn().mockRejectedValue(new Error("provider secret"));
    const adapter = new SupabaseAuthIdentityAdapter({
      anon: () => ({
        auth: {
          signUp: rejected,
          signInWithPassword: rejected,
          refreshSession: rejected,
        },
      }),
    } as never);

    for (const operation of [
      () => adapter.register("u@cra.test", "password", "user"),
      () => adapter.authenticate("u@cra.test", "password"),
      () => adapter.refresh("raw"),
    ]) {
      await expect(operation()).rejects.toThrow(
        "auth identity provider unavailable",
      );
    }
  });

  it("performs every user-scoped MFA operation without caching the client", async () => {
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const enroll = jest.fn().mockResolvedValue({
      data: {
        id: "factor",
        totp: { qr_code: "qr", secret: "secret", uri: "uri" },
      },
      error: null,
    });
    const challenge = jest
      .fn()
      .mockResolvedValue({ data: { id: "challenge" }, error: null });
    const verify = jest.fn().mockResolvedValue({ data: session, error: null });
    const listFactors = jest.fn().mockResolvedValue({
      data: { totp: [{ id: "factor", status: "verified" }] },
      error: null,
    });
    const unenroll = jest.fn().mockResolvedValue({ error: null });
    const asUser = jest.fn(() => ({
      auth: {
        signOut,
        mfa: { enroll, challenge, verify, listFactors, unenroll },
      },
    }));
    const adapter = new SupabaseAuthIdentityAdapter({ asUser } as never);
    await expect(adapter.signOutGlobally("raw")).resolves.toBeUndefined();
    await expect(adapter.enrollMfa("raw")).resolves.toMatchObject({
      factorId: "factor",
    });
    await expect(
      adapter.verifyMfa("raw", "factor", "123456"),
    ).resolves.toMatchObject({ outcome: "verified" });
    await expect(adapter.listUserMfaFactors("raw")).resolves.toEqual([
      { id: "factor", status: "verified" },
    ]);
    await expect(adapter.unenrollMfa("raw", "factor")).resolves.toBe(true);
    expect(asUser).toHaveBeenCalledTimes(5);
  });

  it("maps MFA challenge and verification failures without provider bodies", async () => {
    const adapter = (challengeResult: unknown, verifyResult: unknown) =>
      new SupabaseAuthIdentityAdapter({
        asUser: () => ({
          auth: {
            mfa: {
              challenge: jest.fn().mockResolvedValue(challengeResult),
              verify: jest.fn().mockResolvedValue(verifyResult),
            },
          },
        }),
      } as never);
    await expect(
      adapter({ data: null, error: { message: "secret" } }, {}).verifyMfa(
        "raw",
        "factor",
        "code",
      ),
    ).resolves.toEqual({ outcome: "challenge_failed" });
    await expect(
      adapter(
        { data: { id: "challenge" }, error: null },
        { data: null, error: { message: "secret" } },
      ).verifyMfa("raw", "factor", "code"),
    ).resolves.toEqual({ outcome: "invalid" });
  });

  it("keeps returned provider errors distinct from transport failures", async () => {
    const returnedError = { data: null, error: { message: "provider body" } };
    const adapter = new SupabaseAuthIdentityAdapter({
      admin: () => ({
        auth: {
          admin: {
            updateUserById: jest.fn().mockResolvedValue(returnedError),
          },
        },
      }),
      asUser: () => ({
        auth: {
          mfa: {
            enroll: jest.fn().mockResolvedValue(returnedError),
            listFactors: jest.fn().mockResolvedValue(returnedError),
            unenroll: jest.fn().mockResolvedValue(returnedError),
          },
        },
      }),
    } as never);

    await expect(
      adapter.updatePassword("auth-1", "Password123!"),
    ).resolves.toBe(false);
    await expect(adapter.enrollMfa("raw")).resolves.toBeNull();
    await expect(adapter.listUserMfaFactors("raw")).resolves.toBeNull();
    await expect(adapter.unenrollMfa("raw", "factor")).resolves.toBe(false);
  });

  it("rejects sanitized MFA transport failures", async () => {
    const rejected = jest.fn().mockRejectedValue(new Error("provider secret"));
    const adapter = new SupabaseAuthIdentityAdapter({
      asUser: () => ({
        auth: {
          mfa: {
            enroll: rejected,
            challenge: rejected,
            verify: rejected,
            listFactors: rejected,
            unenroll: rejected,
          },
        },
      }),
    } as never);

    for (const operation of [
      () => adapter.enrollMfa("raw"),
      () => adapter.verifyMfa("raw", "factor", "code"),
      () => adapter.listUserMfaFactors("raw"),
      () => adapter.unenrollMfa("raw", "factor"),
    ]) {
      await expect(operation()).rejects.toThrow(
        "auth identity provider unavailable",
      );
    }
  });
});

type QueryResult = { data: unknown; error: { message: string } | null };
const query = (result: QueryResult) => {
  const builder = {
    data: result.data,
    error: result.error,
    select: jest.fn(),
    ilike: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    insert: jest.fn().mockResolvedValue(result),
    maybeSingle: jest.fn().mockResolvedValue(result),
    order: jest.fn().mockResolvedValue(result),
  };
  builder.select.mockReturnValue(builder);
  builder.ilike.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  builder.delete.mockReturnValue(builder);
  return builder;
};

describe("primary Supabase auth profile operations", () => {
  const user = {
    id: "profile-1",
    auth_user_id: "auth-1",
    email: "u@cra.test",
    username: "user",
    first_name: null,
    last_name: null,
    avatar_url: null,
    is_active: true,
    email_verified_at: null,
  };

  it("maps profile lookups, username resolution, and memberships", async () => {
    const builders = [
      query({ data: { id: "profile-1" }, error: null }),
      query({ data: user, error: null }),
      query({ data: user, error: null }),
      query({ data: user, error: null }),
      query({ data: { email: "u@cra.test" }, error: null }),
      query({
        data: [
          {
            role: "member",
            organizations: { id: "org-1", name: "CRA", slug: "cra" },
          },
          { role: "viewer", organizations: null },
        ],
        error: null,
      }),
    ];
    const from = jest.fn(() => builders.shift()!);
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({ from }),
    } as never);
    await expect(repository.isUsernameTaken("user")).resolves.toBe(true);
    await expect(repository.findByAuthUserId("auth-1")).resolves.toMatchObject({
      id: "profile-1",
      authUserId: "auth-1",
    });
    await expect(repository.findById("profile-1")).resolves.toMatchObject({
      id: "profile-1",
    });
    await expect(repository.findByEmail(" U@CRA.TEST ")).resolves.toMatchObject(
      { email: "u@cra.test" },
    );
    await expect(repository.resolveUsername("user")).resolves.toBe(
      "u@cra.test",
    );
    await expect(repository.listMemberships("profile-1")).resolves.toEqual([
      {
        role: "member",
        organization: { id: "org-1", name: "CRA", slug: "cra" },
      },
    ]);
  });

  it("executes lockout, epoch, and artifact mutations with hashes only", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const builders = Array.from({ length: 5 }, () =>
      query({ data: null, error: null }),
    );
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({ rpc, from: () => builders.shift()! }),
    } as never);
    await repository.lockedUntil("u@cra.test");
    await repository.recordLoginFailure("u@cra.test", 7, 20);
    await repository.clearLoginFailures("u@cra.test");
    await repository.bumpSessionEpoch("profile-1");
    await repository.supersedeVerification("profile-1");
    await repository.storeVerification({
      userId: "profile-1",
      email: "u@cra.test",
      codeHash: "hash",
      expiresAt: "future",
    });
    await repository.storePasswordReset({
      userId: "profile-1",
      tokenHash: "hash",
      expiresAt: "future",
    });
    await repository.replaceRecoveryCodes("profile-1", ["hash-1", "hash-2"]);
    expect(rpc).toHaveBeenCalledWith("record_login_failure", {
      p_email: "u@cra.test",
      p_max_attempts: 7,
      p_window: "20 minutes",
      p_lock_duration: "20 minutes",
    });
  });

  it("fails closed for lockout RPC errors instead of suppressing them", async () => {
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({
        rpc: jest
          .fn()
          .mockResolvedValue({ data: null, error: { message: "secret" } }),
        from: () => query({ data: null, error: null }),
      }),
    } as never);

    await expect(repository.lockedUntil("u@cra.test")).rejects.toThrow(
      "auth profile repository unavailable",
    );
    await expect(
      repository.recordLoginFailure("u@cra.test", 5, 15),
    ).rejects.toThrow("auth profile repository unavailable");
    await expect(repository.clearLoginFailures("u@cra.test")).rejects.toThrow(
      "auth profile repository unavailable",
    );
  });

  it("fails closed for epoch and artifact storage errors", async () => {
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({
        rpc: jest
          .fn()
          .mockResolvedValue({ data: null, error: { message: "secret" } }),
        from: () => query({ data: null, error: { message: "secret" } }),
      }),
    } as never);
    await expect(repository.lockedUntil("u@cra.test")).rejects.toThrow(
      "auth profile repository unavailable",
    );
    await expect(
      repository.recordLoginFailure("u@cra.test", 5, 15),
    ).rejects.toThrow("auth profile repository unavailable");
    await expect(repository.clearLoginFailures("u@cra.test")).rejects.toThrow(
      "auth profile repository unavailable",
    );
    await expect(repository.bumpSessionEpoch("profile-1")).rejects.toThrow(
      "auth profile repository unavailable",
    );
    await expect(
      repository.storeVerification({
        userId: "profile-1",
        email: "u@cra.test",
        codeHash: "hash",
        expiresAt: "future",
      }),
    ).rejects.toThrow("auth profile repository unavailable");
    await expect(
      repository.storePasswordReset({
        userId: "profile-1",
        tokenHash: "hash",
        expiresAt: "future",
      }),
    ).rejects.toThrow("auth profile repository unavailable");
    await expect(
      repository.replaceRecoveryCodes("profile-1", ["hash"]),
    ).rejects.toThrow("auth profile repository unavailable");
  });
});
