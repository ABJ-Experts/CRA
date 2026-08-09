import { createHash } from "node:crypto";

import { SupabaseAuthIdentityAdapter } from "./supabase-auth-identity.adapter";
import { SupabaseAuthProfileRepository } from "./supabase-auth-profile.repository";
import { SupabaseMfaRecoveryRepository } from "./supabase-mfa-recovery.repository";
import {
  NodeSecretHashAdapter,
  SystemDelayAdapter,
} from "./node-auth-runtime.adapter";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_USER_ID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = "33333333-3333-4333-8333-333333333333";

describe("SupabaseAuthProfileRepository", () => {
  it("calls the atomic verification RPC with exact argument keys", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: "verified", error: null });
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.verifyEmailCode(USER_ID, "a".repeat(64), 5),
    ).resolves.toBe("verified");
    expect(rpc).toHaveBeenCalledWith("verify_email_code_atomic", {
      p_user_id: USER_ID,
      p_code_hash: "a".repeat(64),
      p_max_attempts: 5,
    });
  });

  it.each([
    [{ data: "surprise", error: null }],
    [{ data: null, error: null }],
    [{ data: null, error: { message: "db body" } }],
  ])("fails closed for malformed verification output", async (result) => {
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({ rpc: jest.fn().mockResolvedValue(result) }),
    } as never);

    await expect(
      repository.verifyEmailCode(USER_ID, "a".repeat(64), 5),
    ).rejects.toThrow("auth profile repository unavailable");
  });

  it("sanitizes a thrown verification RPC failure", async () => {
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({
        rpc: jest.fn().mockRejectedValue(new Error("database secret body")),
      }),
    } as never);

    const error = await repository
      .verifyEmailCode(USER_ID, "a".repeat(64), 5)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "auth profile repository unavailable",
    );
    expect((error as Error).message).not.toContain("database secret body");
  });

  it("maps the exact password-reset claim RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "consumed",
          user_id: USER_ID,
          auth_user_id: AUTH_USER_ID,
        },
      ],
      error: null,
    });
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.consumePasswordReset("b".repeat(64)),
    ).resolves.toEqual({
      outcome: "consumed",
      userId: USER_ID,
      authUserId: AUTH_USER_ID,
    });
    expect(rpc).toHaveBeenCalledWith("consume_password_reset", {
      p_token_hash: "b".repeat(64),
    });
  });

  it.each([
    [{ data: null, error: null }],
    [{ data: [], error: null }],
    [
      {
        data: [{ outcome: "consumed", user_id: USER_ID, auth_user_id: null }],
        error: null,
      },
    ],
    [
      {
        data: [
          { outcome: "consumed", user_id: "", auth_user_id: AUTH_USER_ID },
        ],
        error: null,
      },
    ],
    [
      {
        data: [
          {
            outcome: "consumed",
            user_id: USER_ID,
            auth_user_id: "not-a-uuid",
          },
        ],
        error: null,
      },
    ],
    [
      {
        data: [
          {
            outcome: "invalid",
            user_id: USER_ID,
            auth_user_id: AUTH_USER_ID,
          },
        ],
        error: null,
      },
    ],
  ])("fails closed for a malformed reset claim", async (result) => {
    const repository = new SupabaseAuthProfileRepository({
      admin: () => ({ rpc: jest.fn().mockResolvedValue(result) }),
    } as never);

    await expect(
      repository.consumePasswordReset("b".repeat(64)),
    ).rejects.toThrow("auth profile repository unavailable");
  });
});

describe("SupabaseAuthIdentityAdapter", () => {
  it("updates a provider password and never stores a user client", async () => {
    const updateUserById = jest.fn().mockResolvedValue({ error: null });
    const admin = jest.fn(() => ({ auth: { admin: { updateUserById } } }));
    const adapter = new SupabaseAuthIdentityAdapter({ admin } as never);

    await adapter.updatePassword(AUTH_USER_ID, "NewPassword123!");
    await adapter.updatePassword(AUTH_USER_ID, "AnotherPassword123!");

    expect(admin).toHaveBeenCalledTimes(2);
    expect(updateUserById).toHaveBeenNthCalledWith(1, AUTH_USER_ID, {
      password: "NewPassword123!",
    });
  });

  it("copies and freezes provider factors", async () => {
    const factors = [{ id: "factor-1" }, { id: "factor-2" }];
    const listFactors = jest
      .fn()
      .mockResolvedValue({ data: { factors }, error: null });
    const adapter = new SupabaseAuthIdentityAdapter({
      admin: () => ({ auth: { admin: { mfa: { listFactors } } } }),
    } as never);

    const result = await adapter.listMfaFactors(AUTH_USER_ID);

    expect(listFactors).toHaveBeenCalledWith({ userId: AUTH_USER_ID });
    expect(result).toEqual(factors);
    expect(result).not.toBe(factors);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
  });

  it("deletes exactly the requested user's factor", async () => {
    const deleteFactor = jest.fn().mockResolvedValue({ error: null });
    const adapter = new SupabaseAuthIdentityAdapter({
      admin: () => ({ auth: { admin: { mfa: { deleteFactor } } } }),
    } as never);

    await adapter.deleteMfaFactor(AUTH_USER_ID, "factor-1");

    expect(deleteFactor).toHaveBeenCalledWith({
      userId: AUTH_USER_ID,
      id: "factor-1",
    });
  });

  it.each(["update", "list", "delete"] as const)(
    "sanitizes a returned %s provider error",
    async (operation) => {
      const failed = jest.fn().mockResolvedValue({
        data: null,
        error: { message: "provider secret body" },
      });
      const adapter = new SupabaseAuthIdentityAdapter({
        admin: () => ({
          auth: {
            admin: {
              updateUserById: failed,
              mfa: { listFactors: failed, deleteFactor: failed },
            },
          },
        }),
      } as never);

      const work =
        operation === "update"
          ? adapter.updatePassword(AUTH_USER_ID, "Password123!")
          : operation === "list"
            ? adapter.listMfaFactors(AUTH_USER_ID)
            : adapter.deleteMfaFactor(AUTH_USER_ID, "factor-1");
      const error = await work.catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "auth identity provider unavailable",
      );
      expect((error as Error).message).not.toContain("provider secret body");
    },
  );
});

describe("SupabaseMfaRecoveryRepository", () => {
  function create(
    implementation: (
      name: string,
      args: Readonly<Record<string, unknown>>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>,
  ) {
    const rpc = jest.fn(implementation);
    return {
      rpc,
      repository: new SupabaseMfaRecoveryRepository({
        admin: () => ({ rpc }),
      } as never),
    };
  }

  it("maps every recovery RPC with exact argument keys", async () => {
    const { repository, rpc } = create((name) => {
      const data: Readonly<Record<string, unknown>> = {
        claim_mfa_recovery: [
          {
            outcome: "claimed",
            operation_id: OPERATION_ID,
            auth_user_id: AUTH_USER_ID,
            status: "claimed",
          },
        ],
        get_mfa_recovery_status: "completed",
        mark_mfa_factors_removed: "factors_removed",
        complete_mfa_recovery: "completed",
        fail_mfa_recovery: "failed",
      };
      return Promise.resolve({ data: data[name], error: null });
    });

    await repository.claim(USER_ID, "c".repeat(64));
    await repository.status(OPERATION_ID, USER_ID);
    await repository.markFactorsRemoved(OPERATION_ID, USER_ID);
    await repository.complete(OPERATION_ID, USER_ID);
    await repository.fail(OPERATION_ID, USER_ID, "delete_factor_failed");

    expect(rpc.mock.calls).toEqual([
      [
        "claim_mfa_recovery",
        { p_user_id: USER_ID, p_code_hash: "c".repeat(64) },
      ],
      [
        "get_mfa_recovery_status",
        { p_operation_id: OPERATION_ID, p_user_id: USER_ID },
      ],
      [
        "mark_mfa_factors_removed",
        { p_operation_id: OPERATION_ID, p_user_id: USER_ID },
      ],
      [
        "complete_mfa_recovery",
        { p_operation_id: OPERATION_ID, p_user_id: USER_ID },
      ],
      [
        "fail_mfa_recovery",
        {
          p_operation_id: OPERATION_ID,
          p_user_id: USER_ID,
          p_error_code: "delete_factor_failed",
        },
      ],
    ]);
  });

  it.each([
    [
      {
        outcome: "invalid",
        operation_id: null,
        auth_user_id: null,
        status: null,
      },
      { outcome: "invalid" },
    ],
    [
      {
        outcome: "resumed",
        operation_id: OPERATION_ID,
        auth_user_id: AUTH_USER_ID,
        status: "factors_removed",
      },
      {
        outcome: "resumed",
        operationId: OPERATION_ID,
        authUserId: AUTH_USER_ID,
        status: "factors_removed",
      },
    ],
    [
      {
        outcome: "in_progress",
        operation_id: OPERATION_ID,
        auth_user_id: AUTH_USER_ID,
        status: "failed",
      },
      {
        outcome: "in_progress",
        operationId: OPERATION_ID,
        authUserId: AUTH_USER_ID,
        status: "failed",
      },
    ],
  ])("maps and freezes a valid recovery claim", async (row, expected) => {
    const { repository } = create(() =>
      Promise.resolve({ data: [row], error: null }),
    );

    const result = await repository.claim(USER_ID, "c".repeat(64));

    expect(result).toEqual(expected);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    [{ data: null, error: null }],
    [{ data: [], error: null }],
    [
      {
        data: [
          {
            outcome: "claimed",
            operation_id: OPERATION_ID,
            auth_user_id: null,
            status: "claimed",
          },
        ],
        error: null,
      },
    ],
    [
      {
        data: [
          {
            outcome: "invalid",
            operation_id: OPERATION_ID,
            auth_user_id: AUTH_USER_ID,
            status: "claimed",
          },
        ],
        error: null,
      },
    ],
    [
      {
        data: [
          {
            outcome: "claimed",
            operation_id: "",
            auth_user_id: AUTH_USER_ID,
            status: "claimed",
          },
        ],
        error: null,
      },
    ],
    [
      {
        data: [
          {
            outcome: "claimed",
            operation_id: OPERATION_ID,
            auth_user_id: "not-a-uuid",
            status: "claimed",
          },
        ],
        error: null,
      },
    ],
  ])("fails closed for a malformed recovery claim", async (result) => {
    const { repository } = create(() => Promise.resolve(result));
    await expect(repository.claim(USER_ID, "c".repeat(64))).rejects.toThrow(
      "MFA recovery repository unavailable",
    );
  });

  it.each([
    ["status", "mystery"],
    ["markFactorsRemoved", "claimed"],
    ["complete", "factors_removed"],
    ["fail", "completed"],
  ] as const)(
    "rejects an invalid %s transition result",
    async (method, data) => {
      const { repository } = create(() =>
        Promise.resolve({ data, error: null }),
      );
      const work =
        method === "status"
          ? repository.status(OPERATION_ID, USER_ID)
          : method === "markFactorsRemoved"
            ? repository.markFactorsRemoved(OPERATION_ID, USER_ID)
            : method === "complete"
              ? repository.complete(OPERATION_ID, USER_ID)
              : repository.fail(OPERATION_ID, USER_ID, "delete_factor_failed");

      await expect(work).rejects.toThrow("MFA recovery repository unavailable");
    },
  );

  it("sanitizes a returned transition RPC failure", async () => {
    const { repository } = create(() =>
      Promise.resolve({
        data: null,
        error: { message: "database secret body" },
      }),
    );

    const error = await repository
      .status(OPERATION_ID, USER_ID)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "MFA recovery repository unavailable",
    );
    expect((error as Error).message).not.toContain("database secret body");
  });
});

describe("NodeSecretHashAdapter", () => {
  it("returns a SHA-256 digest without retaining the secret", () => {
    const adapter = new NodeSecretHashAdapter();
    expect(adapter.hash("credential")).toBe(
      createHash("sha256").update("credential").digest("hex"),
    );
    expect(Object.keys(adapter)).toEqual([]);
  });
});

describe("SystemDelayAdapter", () => {
  afterEach(() => jest.useRealTimers());

  it("waits for the requested duration without retaining state", async () => {
    jest.useFakeTimers();
    const adapter = new SystemDelayAdapter();

    const work = adapter.wait(25);
    await jest.advanceTimersByTimeAsync(25);

    await expect(work).resolves.toBeUndefined();
    expect(Object.keys(adapter)).toEqual([]);
  });
});
