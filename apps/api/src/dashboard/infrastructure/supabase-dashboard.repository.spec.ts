import { Logger } from "@nestjs/common";
import { SupabaseDashboardRepository } from "./supabase-dashboard.repository";
import {
  DashboardUnavailableError,
  DashboardNotFoundError,
} from "../application/dashboard-read.port";
import type { SupabaseService } from "../../supabase/supabase.service";

describe("dashboard provider boundary", () => {
  const rpc = jest.fn();
  const repository = new SupabaseDashboardRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);
  let warn: jest.SpyInstance;
  beforeEach(() => {
    rpc.mockReset();
    warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());
  it("passes verified org first and actor separately", async () => {
    rpc.mockResolvedValue({
      data: {
        outcome: "found",
        result: { organizationId: "org" },
        nextPosition: null,
      },
      error: null,
    });
    expect(
      await repository.read("org", {
        actorId: "actor",
        endpoint: "overview",
        filters: {},
      }),
    ).toEqual({ result: { organizationId: "org" }, nextPosition: null });
    expect(rpc).toHaveBeenCalledWith("get_dashboard_projection", {
      p_organization_id: "org",
      p_actor_user_id: "actor",
      p_endpoint: "overview",
      p_filters: {},
    });
  });
  it.each([
    null,
    {},
    { outcome: "unknown" },
    { outcome: "found" },
    [
      { outcome: "found", result: {} },
      { outcome: "found", result: {} },
    ],
  ])("rejects malformed provider envelope %p", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "overview",
        filters: {},
      }),
    ).rejects.toBeInstanceOf(DashboardUnavailableError);
  });
  it.each(["not_found", "forbidden"])(
    "withholds inaccessible product %s",
    async (outcome) => {
      rpc.mockResolvedValue({ data: { outcome }, error: null });
      await expect(
        repository.read("org", {
          actorId: "actor",
          endpoint: "posture",
          filters: {},
        }),
      ).rejects.toBeInstanceOf(DashboardNotFoundError);
    },
  );
  it.each([
    [
      { code: "57014", message: "secret SQL and credentials" },
      "provider_timeout",
    ],
    [{ code: "PGRST003", details: "private pool details" }, "provider_timeout"],
    [
      { code: "XX000", message: "private database details" },
      "provider_unavailable",
    ],
    [
      { code: "secret-canary", message: "secret token" },
      "provider_unavailable",
    ],
  ])(
    "records only a safe returned failure classification",
    async (error, classification) => {
      rpc.mockResolvedValue({ data: null, error });
      await expect(
        repository.read("secret-org", {
          actorId: "secret-actor",
          endpoint: "overview",
          filters: { productId: "secret-product" },
        }),
      ).rejects.toThrow("Dashboard temporarily unavailable");
      expect(warn).toHaveBeenCalledWith({
        endpoint: "overview",
        classification,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
    },
  );
  it("distinguishes malformed envelopes without logging their contents", async () => {
    rpc.mockResolvedValue({
      data: { privateContent: "secret-canary" },
      error: null,
    });
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "posture",
        filters: {},
      }),
    ).rejects.toBeInstanceOf(DashboardUnavailableError);
    expect(warn).toHaveBeenCalledWith({
      endpoint: "posture",
      classification: "provider_contract_invalid",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-canary");
  });
  it("does not log denials as infrastructure failures", async () => {
    rpc.mockResolvedValue({ data: { outcome: "forbidden" }, error: null });
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "posture",
        filters: {},
      }),
    ).rejects.toBeInstanceOf(DashboardNotFoundError);
    expect(warn).not.toHaveBeenCalled();
  });
  it("classifies thrown failures without inspecting their private message", async () => {
    rpc.mockRejectedValue(new Error("secret-canary"));
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "ingestion",
        filters: {},
      }),
    ).rejects.toBeInstanceOf(DashboardUnavailableError);
    expect(warn).toHaveBeenCalledWith({
      endpoint: "ingestion",
      classification: "provider_unavailable",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-canary");
  });
  it("retains the safe error when the diagnostic sink throws", async () => {
    warn.mockImplementation(() => {
      throw new Error("secret-log-failure");
    });
    rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "overview",
        filters: {},
      }),
    ).rejects.toThrow("Dashboard temporarily unavailable");
  });
  it("sanitizes returned and thrown database failures", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "secret provider failure" },
    });
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "overview",
        filters: {},
      }),
    ).rejects.toThrow("Dashboard temporarily unavailable");
    rpc.mockRejectedValue(new Error("secret"));
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "overview",
        filters: {},
      }),
    ).rejects.toThrow("Dashboard temporarily unavailable");
  });
});
