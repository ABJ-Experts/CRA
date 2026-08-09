import { createHash } from "node:crypto";

import {
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";

import { MfaService } from "./mfa.service";
import { RecoverMfaUseCase } from "../application/auth-use-cases";
import {
  NodeSecretHashAdapter,
  SystemDelayAdapter,
} from "../infrastructure/node-auth-runtime.adapter";
import { SupabaseAuthIdentityAdapter } from "../infrastructure/supabase-auth-identity.adapter";
import { SupabaseMfaRecoveryRepository } from "../infrastructure/supabase-mfa-recovery.repository";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_USER_ID = "22222222-2222-4222-8222-222222222222";
const OPERATION_ID = "33333333-3333-4333-8333-333333333333";
const RAW_CODE = "ABCD-EF12";
const CODE_HASH = createHash("sha256").update("abcdef12").digest("hex");

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

type RpcImplementation = (
  name: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<RpcResult>;

function claimResult(status = "claimed"): RpcResult {
  return {
    data: [
      {
        outcome: status === "claimed" ? "claimed" : "resumed",
        operation_id: OPERATION_ID,
        auth_user_id: AUTH_USER_ID,
        status,
      },
    ],
    error: null,
  };
}

function claimedRow(): unknown {
  return {
    outcome: "claimed",
    operation_id: OPERATION_ID,
    auth_user_id: AUTH_USER_ID,
    status: "claimed",
  };
}

function defaultRpc(name: string): Promise<RpcResult> {
  const results: Readonly<Record<string, RpcResult>> = {
    claim_mfa_recovery: claimResult(),
    mark_mfa_factors_removed: { data: "factors_removed", error: null },
    complete_mfa_recovery: { data: "completed", error: null },
    fail_mfa_recovery: { data: "failed", error: null },
    get_mfa_recovery_status: { data: "completed", error: null },
  };
  return Promise.resolve(results[name]!);
}

function createService(input?: {
  rpc?: RpcImplementation;
  listFactors?: () => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
  deleteFactor?: (args: {
    id: string;
    userId: string;
  }) => Promise<{ error: { message: string } | null }>;
}) {
  const rpc = jest.fn(input?.rpc ?? defaultRpc);
  const listFactors = jest.fn(
    input?.listFactors ??
      (() => Promise.resolve({ data: { factors: [] }, error: null })),
  );
  const deleteFactor = jest.fn(
    input?.deleteFactor ?? (() => Promise.resolve({ error: null })),
  );
  const auditLog = jest.fn();
  const adminClient = {
    rpc,
    auth: { admin: { mfa: { listFactors, deleteFactor } } },
  };
  const supabase = { admin: () => adminClient } as never;
  const recoverMfa = new RecoverMfaUseCase(
    new SupabaseMfaRecoveryRepository(supabase),
    new SupabaseAuthIdentityAdapter(supabase),
    new NodeSecretHashAdapter(),
    new SystemDelayAdapter(),
  );
  const service = new MfaService(
    supabase,
    { log: auditLog } as never,
    recoverMfa,
  );

  return { service, rpc, listFactors, deleteFactor, auditLog };
}

async function captureError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    throw new Error("Expected operation to fail");
  } catch (error) {
    return error;
  }
}

describe("MfaService.redeemRecoveryCode", () => {
  it("claims, removes every factor, marks removal, and completes in order", async () => {
    const { service, rpc, listFactors, deleteFactor, auditLog } = createService(
      {
        listFactors: () =>
          Promise.resolve({
            data: { factors: [{ id: "factor-1" }, { id: "factor-2" }] },
            error: null,
          }),
      },
    );

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenNthCalledWith(1, "claim_mfa_recovery", {
      p_user_id: USER_ID,
      p_code_hash: CODE_HASH,
    });
    expect(listFactors).toHaveBeenCalledWith({ userId: AUTH_USER_ID });
    expect(deleteFactor).toHaveBeenNthCalledWith(1, {
      id: "factor-1",
      userId: AUTH_USER_ID,
    });
    expect(deleteFactor).toHaveBeenNthCalledWith(2, {
      id: "factor-2",
      userId: AUTH_USER_ID,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "mark_mfa_factors_removed", {
      p_operation_id: OPERATION_ID,
      p_user_id: USER_ID,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "complete_mfa_recovery", {
      p_operation_id: OPERATION_ID,
      p_user_id: USER_ID,
    });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      listFactors.mock.invocationCallOrder[0]!,
    );
    expect(listFactors.mock.invocationCallOrder[0]).toBeLessThan(
      deleteFactor.mock.invocationCallOrder[0]!,
    );
    expect(deleteFactor.mock.invocationCallOrder[1]).toBeLessThan(
      rpc.mock.invocationCallOrder[1]!,
    );
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(
      rpc.mock.invocationCallOrder[2]!,
    );
    expect(auditLog).not.toHaveBeenCalled();
  });

  it("maps an invalid recovery code to the existing unauthorized response", async () => {
    const { service, listFactors } = createService({
      rpc: () =>
        Promise.resolve({
          data: [
            {
              outcome: "invalid",
              operation_id: null,
              auth_user_id: null,
              status: null,
            },
          ],
          error: null,
        }),
    });

    const error = await captureError(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    );

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      message: "That recovery code is not valid.",
      code: "mfa_recovery_invalid",
    });
    expect(listFactors).not.toHaveBeenCalled();
  });

  it.each([
    ["database error", { data: null, error: { message: "db down" } }],
    ["null data", { data: null, error: null }],
    ["empty data", { data: [], error: null }],
    ["multiple rows", { data: [claimedRow(), claimedRow()], error: null }],
    [
      "unknown outcome",
      {
        data: [
          {
            outcome: "surprise",
            operation_id: OPERATION_ID,
            auth_user_id: AUTH_USER_ID,
            status: "claimed",
          },
        ],
        error: null,
      },
    ],
    [
      "partial claimed row",
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
      "unknown status",
      {
        data: [
          {
            outcome: "claimed",
            operation_id: OPERATION_ID,
            auth_user_id: AUTH_USER_ID,
            status: "mystery",
          },
        ],
        error: null,
      },
    ],
    [
      "claimed outcome with resumed status",
      {
        data: [
          {
            outcome: "claimed",
            operation_id: OPERATION_ID,
            auth_user_id: AUTH_USER_ID,
            status: "failed",
          },
        ],
        error: null,
      },
    ],
    [
      "invalid outcome with leaked identifiers",
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
  ])("fails closed for claim %s", async (_name, result) => {
    const { service, listFactors } = createService({
      rpc: () => Promise.resolve(result),
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(listFactors).not.toHaveBeenCalled();
  });

  it("maps a thrown claim failure to the standard 503 response", async () => {
    const { service, listFactors } = createService({
      rpc: () => Promise.reject(new Error("database unavailable")),
    });

    const error = await captureError(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      message: "Sign-in is temporarily unavailable. Please try again.",
      code: "auth_unavailable",
    });
    expect(listFactors).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted auth identity differs from the caller", async () => {
    const differentAuthUser = "44444444-4444-4444-8444-444444444444";
    const { service, listFactors } = createService();

    await expect(
      service.redeemRecoveryCode(USER_ID, differentAuthUser, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(listFactors).not.toHaveBeenCalled();
  });

  it("resumes a failed operation and retries the provider work", async () => {
    const { service, listFactors } = createService({
      rpc: (name) =>
        name === "claim_mfa_recovery"
          ? Promise.resolve(claimResult("failed"))
          : defaultRpc(name),
    });

    await service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE);

    expect(listFactors).toHaveBeenCalledTimes(1);
  });

  it("coalesces an overlapping submission without duplicate provider calls", async () => {
    let claimCount = 0;
    let completed = false;
    let releaseProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const { service, rpc, listFactors, deleteFactor } = createService({
      rpc: (name) => {
        if (name === "claim_mfa_recovery") {
          claimCount += 1;
          return Promise.resolve(
            claimCount === 1
              ? claimResult("claimed")
              : {
                  data: [
                    {
                      outcome: "in_progress",
                      operation_id: OPERATION_ID,
                      auth_user_id: AUTH_USER_ID,
                      status: "claimed",
                    },
                  ],
                  error: null,
                },
          );
        }
        if (name === "get_mfa_recovery_status") {
          return Promise.resolve({
            data: completed ? "completed" : "claimed",
            error: null,
          });
        }
        if (name === "complete_mfa_recovery") {
          completed = true;
        }
        return defaultRpc(name);
      },
      listFactors: async () => {
        await providerGate;
        return { data: { factors: [{ id: "factor-1" }] }, error: null };
      },
    });

    const first = service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE);
    await new Promise((resolve) => setImmediate(resolve));
    const second = service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE);
    setTimeout(() => releaseProvider?.(), 650);

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(listFactors).toHaveBeenCalledTimes(1);
    expect(deleteFactor).toHaveBeenCalledTimes(1);
    expect(
      rpc.mock.calls.filter(([name]) => name === "mark_mfa_factors_removed"),
    ).toHaveLength(1);
    expect(
      rpc.mock.calls.filter(([name]) => name === "complete_mfa_recovery"),
    ).toHaveLength(1);
  });

  it.each([
    ["failed operation", { data: "failed", error: null }],
    ["database error", { data: null, error: { message: "db down" } }],
    ["unknown status", { data: "future_state", error: null }],
  ])(
    "fails closed while observing an in-progress %s",
    async (_name, status) => {
      const { service, listFactors } = createService({
        rpc: (name) => {
          if (name === "claim_mfa_recovery") {
            return Promise.resolve({
              data: [
                {
                  outcome: "in_progress",
                  operation_id: OPERATION_ID,
                  auth_user_id: AUTH_USER_ID,
                  status: "claimed",
                },
              ],
              error: null,
            });
          }
          return name === "get_mfa_recovery_status"
            ? Promise.resolve(status)
            : defaultRpc(name);
        },
      });

      await expect(
        service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(listFactors).not.toHaveBeenCalled();
    },
  );

  it("resumes after factor removal without repeating provider calls", async () => {
    const { service, rpc, listFactors, deleteFactor } = createService({
      rpc: (name) =>
        name === "claim_mfa_recovery"
          ? Promise.resolve(claimResult("factors_removed"))
          : defaultRpc(name),
    });

    await service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE);

    expect(listFactors).not.toHaveBeenCalled();
    expect(deleteFactor).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith("complete_mfa_recovery", {
      p_operation_id: OPERATION_ID,
      p_user_id: USER_ID,
    });
  });

  it("fails closed for an impossible completed claim", async () => {
    const { service, listFactors } = createService({
      rpc: (name) =>
        name === "claim_mfa_recovery"
          ? Promise.resolve(claimResult("completed"))
          : defaultRpc(name),
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(listFactors).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown", "malformed"])(
    "persists list-factor failure when the provider response is %s",
    async (failureKind) => {
      const listFactors =
        failureKind === "thrown"
          ? () => Promise.reject(new Error("provider body"))
          : failureKind === "malformed"
            ? () => Promise.resolve({ data: null, error: null })
            : () =>
                Promise.resolve({
                  data: null,
                  error: { message: "provider body" },
                });
      const { service, rpc } = createService({ listFactors });

      await expect(
        service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(rpc).toHaveBeenLastCalledWith("fail_mfa_recovery", {
        p_operation_id: OPERATION_ID,
        p_user_id: USER_ID,
        p_error_code: "list_factors_failed",
      });
    },
  );

  it("resumes safely after one factor was deleted", async () => {
    let claimCount = 0;
    let listCount = 0;
    const { service, rpc, deleteFactor } = createService({
      rpc: (name) => {
        if (name === "claim_mfa_recovery") {
          claimCount += 1;
          return Promise.resolve(
            claimResult(claimCount === 1 ? "claimed" : "failed"),
          );
        }
        return defaultRpc(name);
      },
      listFactors: () => {
        listCount += 1;
        return Promise.resolve({
          data: {
            factors:
              listCount === 1
                ? [{ id: "factor-1" }, { id: "factor-2" }]
                : [{ id: "factor-2" }],
          },
          error: null,
        });
      },
      deleteFactor: ({ id }) =>
        Promise.resolve({
          error:
            id === "factor-2" && listCount === 1
              ? { message: "provider body" }
              : null,
        }),
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).resolves.toBeUndefined();

    expect(deleteFactor).toHaveBeenCalledTimes(3);
    expect(
      rpc.mock.calls.filter(([name]) => name === "fail_mfa_recovery"),
    ).toHaveLength(1);
    expect(rpc).toHaveBeenLastCalledWith("complete_mfa_recovery", {
      p_operation_id: OPERATION_ID,
      p_user_id: USER_ID,
    });
  });

  it("persists a thrown factor-deletion failure", async () => {
    const { service, rpc } = createService({
      listFactors: () =>
        Promise.resolve({
          data: { factors: [{ id: "factor-1" }] },
          error: null,
        }),
      deleteFactor: () => Promise.reject(new Error("provider body")),
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(rpc).toHaveBeenLastCalledWith("fail_mfa_recovery", {
      p_operation_id: OPERATION_ID,
      p_user_id: USER_ID,
      p_error_code: "delete_factor_failed",
    });
  });

  it("treats a factor without an id as a malformed provider response", async () => {
    const { service, rpc } = createService({
      listFactors: () =>
        Promise.resolve({ data: { factors: [{}] }, error: null }),
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(rpc).toHaveBeenLastCalledWith("fail_mfa_recovery", {
      p_operation_id: OPERATION_ID,
      p_user_id: USER_ID,
      p_error_code: "list_factors_failed",
    });
  });

  it("returns 503 if factor-removal persistence fails after provider cleanup", async () => {
    const { service, rpc } = createService({
      rpc: (name) =>
        name === "mark_mfa_factors_removed"
          ? Promise.resolve({ data: null, error: { message: "db down" } })
          : defaultRpc(name),
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(rpc).not.toHaveBeenCalledWith(
      "complete_mfa_recovery",
      expect.anything(),
    );
  });

  it.each([
    [
      "unexpected outcome",
      () => Promise.resolve({ data: "not_found", error: null }),
    ],
    ["thrown failure", () => Promise.reject(new Error("db down"))],
  ])(
    "fails closed when factor-removal persistence has %s",
    async (_name, mark) => {
      const { service, rpc } = createService({
        rpc: (name) =>
          name === "mark_mfa_factors_removed" ? mark() : defaultRpc(name),
      });

      await expect(
        service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(rpc).not.toHaveBeenCalledWith(
        "complete_mfa_recovery",
        expect.anything(),
      );
    },
  );

  it("retries completion without repeating provider cleanup", async () => {
    let claimCount = 0;
    let completeCount = 0;
    const { service, listFactors } = createService({
      rpc: (name) => {
        if (name === "claim_mfa_recovery") {
          claimCount += 1;
          return Promise.resolve(
            claimResult(claimCount === 1 ? "claimed" : "factors_removed"),
          );
        }
        if (name === "complete_mfa_recovery") {
          completeCount += 1;
          return Promise.resolve(
            completeCount === 1
              ? { data: null, error: { message: "db down" } }
              : { data: "completed", error: null },
          );
        }
        return defaultRpc(name);
      },
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).resolves.toBeUndefined();

    expect(listFactors).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "unexpected outcome",
      () => Promise.resolve({ data: "invalid_state", error: null }),
    ],
    ["thrown failure", () => Promise.reject(new Error("db down"))],
  ])("fails closed when completion has %s", async (_name, complete) => {
    const { service } = createService({
      rpc: (name) => {
        if (name === "claim_mfa_recovery") {
          return Promise.resolve(claimResult("factors_removed"));
        }
        return name === "complete_mfa_recovery" ? complete() : defaultRpc(name);
      },
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it.each([
    [
      "returned",
      () =>
        Promise.resolve({
          data: null,
          error: { message: "database unavailable" },
        }),
    ],
    ["thrown", () => Promise.reject(new Error("database unavailable"))],
  ])(
    "still returns 503 if persisting a provider failure is %s",
    async (_name, persistenceFailure) => {
      const { service } = createService({
        rpc: (name) =>
          name === "fail_mfa_recovery"
            ? persistenceFailure()
            : defaultRpc(name),
        listFactors: () => Promise.reject(new Error("provider unavailable")),
      });

      await expect(
        service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );

  it("never logs the raw recovery code or its hash", async () => {
    const log = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const { service } = createService({
      listFactors: () => Promise.reject(new Error(RAW_CODE)),
    });

    await expect(
      service.redeemRecoveryCode(USER_ID, AUTH_USER_ID, RAW_CODE),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain(RAW_CODE);
    expect(logged).not.toContain(CODE_HASH);
    log.mockRestore();
  });
});
