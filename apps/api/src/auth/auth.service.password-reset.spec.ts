import { createHash } from "node:crypto";

import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";

import { AuthService } from "./auth.service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_USER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "raw-reset-token";
const PASSWORD = "NewPassword123!";
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

function createService(
  rpcImplementation: () => Promise<RpcResult> = () =>
    Promise.resolve({
      data: [
        {
          outcome: "consumed",
          user_id: USER_ID,
          auth_user_id: AUTH_USER_ID,
        },
      ],
      error: null,
    }),
  updateImplementation: () => Promise<{
    error: { message: string } | null;
  }> = () => Promise.resolve({ error: null }),
) {
  const rpc = jest.fn(rpcImplementation);
  const updateUserById = jest.fn(updateImplementation);
  const adminClient = {
    rpc,
    auth: { admin: { updateUserById } },
  };
  const service = new AuthService(
    { admin: () => adminClient } as never,
    {} as never,
    {} as never,
  );

  return { service, rpc, updateUserById };
}

async function captureError(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    throw new Error("Expected operation to fail");
  } catch (error) {
    return error;
  }
}

describe("AuthService.resetPassword", () => {
  it("consumes the hashed token before changing the provider password", async () => {
    const { service, rpc, updateUserById } = createService();

    await expect(
      service.resetPassword({ token: TOKEN, password: PASSWORD }),
    ).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith("consume_password_reset", {
      p_token_hash: TOKEN_HASH,
    });
    expect(updateUserById).toHaveBeenCalledWith(AUTH_USER_ID, {
      password: PASSWORD,
    });
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(
      updateUserById.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["invalid", "reset_token_invalid"],
    ["expired", "reset_token_expired"],
    ["profile_missing", "reset_token_invalid"],
  ])(
    "maps the %s outcome to the existing dead-link response",
    async (outcome, code) => {
      const { service, updateUserById } = createService(() =>
        Promise.resolve({
          data: [{ outcome, user_id: null, auth_user_id: null }],
          error: null,
        }),
      );

      const error = await captureError(
        service.resetPassword({ token: TOKEN, password: PASSWORD }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        message: "That reset link has expired.",
        code,
      });
      expect(updateUserById).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["database error", { data: null, error: { message: "db unavailable" } }],
    ["null data", { data: null, error: null }],
    ["empty data", { data: [], error: null }],
    [
      "multiple rows",
      {
        data: [
          { outcome: "invalid", user_id: null, auth_user_id: null },
          { outcome: "invalid", user_id: null, auth_user_id: null },
        ],
        error: null,
      },
    ],
    [
      "unknown outcome",
      {
        data: [{ outcome: "surprise", user_id: null, auth_user_id: null }],
        error: null,
      },
    ],
    [
      "partial consumed row",
      {
        data: [{ outcome: "consumed", user_id: USER_ID, auth_user_id: null }],
        error: null,
      },
    ],
  ])("fails closed for %s", async (_name, result) => {
    const { service, updateUserById } = createService(() =>
      Promise.resolve(result),
    );

    const error = await captureError(
      service.resetPassword({ token: TOKEN, password: PASSWORD }),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      message: "We could not update that password.",
      code: "password_update_failed",
    });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("maps a thrown database failure to 503 without calling the provider", async () => {
    const { service, updateUserById } = createService(() =>
      Promise.reject(new Error("socket closed")),
    );

    await expect(
      service.resetPassword({ token: TOKEN, password: PASSWORD }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it.each(["returned", "thrown"])(
    "keeps the token consumed when the provider failure is %s",
    async (failureKind) => {
      const providerError = new Error("identity provider unavailable");
      const update =
        failureKind === "thrown"
          ? () => Promise.reject(providerError)
          : () => Promise.resolve({ error: providerError });
      const { service, rpc, updateUserById } = createService(undefined, update);

      const error = await captureError(
        service.resetPassword({ token: TOKEN, password: PASSWORD }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        message: "We could not update that password.",
        code: "password_update_failed",
      });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(updateUserById).toHaveBeenCalledTimes(1);
    },
  );

  it("allows only the successful claimant to call the provider", async () => {
    let claimNumber = 0;
    const { service, updateUserById } = createService(() => {
      claimNumber += 1;
      return Promise.resolve(
        claimNumber === 1
          ? {
              data: [
                {
                  outcome: "consumed",
                  user_id: USER_ID,
                  auth_user_id: AUTH_USER_ID,
                },
              ],
              error: null,
            }
          : {
              data: [{ outcome: "invalid", user_id: null, auth_user_id: null }],
              error: null,
            },
      );
    });

    const results = await Promise.allSettled([
      service.resetPassword({ token: TOKEN, password: PASSWORD }),
      service.resetPassword({ token: TOKEN, password: PASSWORD }),
    ]);

    expect(results.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });

  it("never logs the reset credential, hash, or password", async () => {
    const log = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const { service } = createService(undefined, () =>
      Promise.resolve({
        error: { message: "provider unavailable" },
      }),
    );

    await expect(
      service.resetPassword({ token: TOKEN, password: PASSWORD }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const logged = log.mock.calls.flat().join(" ");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(TOKEN_HASH);
    expect(logged).not.toContain(PASSWORD);
    log.mockRestore();
  });
});
