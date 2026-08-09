import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";

import { SupabaseService } from "./supabase.service";

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(),
}));

const mockedCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

function config(): {
  serviceConfig: ConfigService;
  getOrThrow: jest.Mock;
} {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  const getOrThrow = jest.fn((key: string) => values[key]);
  return {
    serviceConfig: { getOrThrow } as unknown as ConfigService,
    getOrThrow,
  };
}

describe("SupabaseService", () => {
  beforeEach(() => {
    mockedCreateClient.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads every required credential at construction", () => {
    const { serviceConfig, getOrThrow } = config();

    new SupabaseService(serviceConfig);

    expect(getOrThrow).toHaveBeenNthCalledWith(1, "SUPABASE_URL");
    expect(getOrThrow).toHaveBeenNthCalledWith(2, "SUPABASE_ANON_KEY");
    expect(getOrThrow).toHaveBeenNthCalledWith(3, "SUPABASE_SERVICE_ROLE_KEY");
  });

  it("creates one isolated service-role client and reuses it", () => {
    const adminClient = { kind: "admin" };
    mockedCreateClient.mockReturnValue(adminClient as never);
    const service = new SupabaseService(config().serviceConfig);

    expect(service.admin()).toBe(adminClient);
    expect(service.admin()).toBe(adminClient);
    expect(mockedCreateClient).toHaveBeenCalledTimes(1);
    expect(mockedCreateClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-key",
      clientOptions,
    );
  });

  it("creates a fresh anonymous client for every request", () => {
    const first = { request: 1 };
    const second = { request: 2 };
    mockedCreateClient
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    const service = new SupabaseService(config().serviceConfig);

    expect(service.anon()).toBe(first);
    expect(service.anon()).toBe(second);
    expect(mockedCreateClient).toHaveBeenNthCalledWith(
      1,
      "https://example.supabase.co",
      "anon-key",
      clientOptions,
    );
    expect(mockedCreateClient).toHaveBeenNthCalledWith(
      2,
      "https://example.supabase.co",
      "anon-key",
      clientOptions,
    );
  });

  it("creates a fresh user client carrying only that request token", () => {
    const userClient = { kind: "user" };
    mockedCreateClient.mockReturnValue(userClient as never);
    const service = new SupabaseService(config().serviceConfig);

    expect(service.asUser("access-token")).toBe(userClient);
    expect(mockedCreateClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "anon-key",
      {
        ...clientOptions,
        global: { headers: { Authorization: "Bearer access-token" } },
      },
    );
  });

  it.each([
    [{ error: null }, true],
    [{ error: { message: "database unavailable" } }, false],
  ])(
    "reports database readiness from the liveness query",
    async (result, ready) => {
      const limit = jest.fn().mockResolvedValue(result);
      const select = jest.fn().mockReturnValue({ limit });
      const from = jest.fn().mockReturnValue({ select });
      mockedCreateClient.mockReturnValue({ from } as never);
      const loggerError = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation();
      const service = new SupabaseService(config().serviceConfig);

      await expect(service.ping()).resolves.toBe(ready);
      expect(from).toHaveBeenCalledWith("organizations");
      expect(select).toHaveBeenCalledWith("id");
      expect(limit).toHaveBeenCalledWith(1);
      if (ready) {
        expect(loggerError).not.toHaveBeenCalled();
      } else {
        expect(loggerError).toHaveBeenCalledWith(
          "Supabase ping failed: database unavailable",
        );
      }
    },
  );
});
