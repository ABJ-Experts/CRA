import { ServiceUnavailableException } from "@nestjs/common";

import { TooManyRequestsException } from "../common/exceptions/too-many-requests.exception";
import { AuthService } from "./auth.service";
import { ReauthenticateUserUseCase } from "./application/auth-use-cases";
import { SystemDelayAdapter } from "./infrastructure/node-auth-runtime.adapter";
import { SupabaseAuthIdentityAdapter } from "./infrastructure/supabase-auth-identity.adapter";
import { SupabaseAuthProfileRepository } from "./infrastructure/supabase-auth-profile.repository";

describe("AuthService.verifyPassword lockout", () => {
  afterEach(() => jest.useRealTimers());

  function createService(input: {
    lockedUntil: string | null;
    signInResult: {
      data: { session: object | null };
      error: { message: string } | null;
    };
  }) {
    const signInWithPassword = jest.fn().mockResolvedValue(input.signInResult);
    const rpc = jest.fn((name: string) => {
      if (name === "is_login_locked") {
        return Promise.resolve({ data: input.lockedUntil, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const supabase = {
      admin: () => ({ rpc }),
      anon: () => ({ auth: { signInWithPassword } }),
    } as never;
    const reauthenticate = new ReauthenticateUserUseCase(
      new SupabaseAuthProfileRepository(supabase),
      new SupabaseAuthIdentityAdapter(supabase),
      new SystemDelayAdapter(),
      300,
      5,
      15,
    );
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      reauthenticate,
    );

    return { service, rpc, signInWithPassword };
  }

  it("does not call GoTrue for an account that is already locked", async () => {
    const { service, signInWithPassword } = createService({
      lockedUntil: "2099-01-01T00:00:00.000Z",
      signInResult: { data: { session: null }, error: null },
    });

    await expect(
      service.verifyPassword("USER@CRA.TEST", "wrong"),
    ).rejects.toBeInstanceOf(TooManyRequestsException);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("records a failed lock-screen password attempt", async () => {
    jest.useFakeTimers();
    const { service, rpc } = createService({
      lockedUntil: null,
      signInResult: {
        data: { session: null },
        error: { message: "invalid credentials" },
      },
    });

    const pending = service.verifyPassword("USER@CRA.TEST", "wrong");
    await jest.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("record_login_failure", {
      p_email: "user@cra.test",
      p_max_attempts: 5,
      p_window: "15 minutes",
      p_lock_duration: "15 minutes",
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "clear_login_attempts",
      expect.anything(),
    );
  });

  it("clears prior failures after a successful lock-screen password", async () => {
    jest.useFakeTimers();
    const { service, rpc } = createService({
      lockedUntil: null,
      signInResult: { data: { session: {} }, error: null },
    });

    const pending = service.verifyPassword("USER@CRA.TEST", "password");
    await jest.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("clear_login_attempts", {
      p_email: "user@cra.test",
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "record_login_failure",
      expect.anything(),
    );
  });

  it("returns 503 and avoids lockout writes during an identity-provider outage", async () => {
    jest.useFakeTimers();
    const signInWithPassword = jest
      .fn()
      .mockRejectedValue(new Error("provider offline"));
    const rpc = jest.fn((name: string) => {
      if (name === "is_login_locked") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const supabase = {
      admin: () => ({ rpc }),
      anon: () => ({ auth: { signInWithPassword } }),
    } as never;
    const reauthenticate = new ReauthenticateUserUseCase(
      new SupabaseAuthProfileRepository(supabase),
      new SupabaseAuthIdentityAdapter(supabase),
      new SystemDelayAdapter(),
      300,
      5,
      15,
    );
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      reauthenticate,
    );

    const pending = service.verifyPassword("USER@CRA.TEST", "password");
    const rejection = expect(pending).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await jest.advanceTimersByTimeAsync(300);

    await rejection;
    expect(rpc).not.toHaveBeenCalledWith(
      "record_login_failure",
      expect.anything(),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "clear_login_attempts",
      expect.anything(),
    );
  });
});
