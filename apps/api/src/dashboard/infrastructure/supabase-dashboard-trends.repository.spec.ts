import { SupabaseDashboardTrendsRepository } from "./supabase-dashboard-trends.repository";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  DashboardNotFoundError,
  DashboardUnavailableError,
} from "../application/dashboard-read.port";
import { DashboardDatasetConflictError } from "../application/dashboard-trends.port";
describe("trend provider boundary", () => {
  function setup() {
    const rpc = jest.fn();
    const repository = new SupabaseDashboardTrendsRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    return { rpc, repository };
  }
  it("passes tenant first and parsed pin to the source RPC", async () => {
    const { rpc, repository } = setup();
    rpc.mockResolvedValue({
      data: { outcome: "found", result: {}, snapshot: {} },
      error: null,
    });
    expect(
      await repository.read("org", {
        actorId: "actor",
        endpoint: "trends",
        filters: { timezone: "UTC" },
      }),
    ).toEqual({ result: {}, snapshot: {} });
    expect(rpc).toHaveBeenCalledWith("get_dashboard_trends", {
      p_organization_id: "org",
      p_actor_user_id: "actor",
      p_filters: { timezone: "UTC" },
      p_snapshot: null,
    });
    await repository.read("org", {
      actorId: "actor",
      endpoint: "sources",
      filters: {},
      snapshot: { epoch: "pin" },
    });
    expect((rpc.mock.calls[1] as [string])[0]).toBe(
      "get_dashboard_trend_sources",
    );
  });
  it("rejects obsolete deployment pins as conflicts", async () => {
    const { rpc, repository } = setup();
    rpc.mockResolvedValue({ data: { outcome: "conflict" }, error: null });
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "trends",
        filters: {},
      }),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
  });
  it.each(["not_found", "forbidden"])(
    "conceals %s existence",
    async (outcome) => {
      const { rpc, repository } = setup();
      rpc.mockResolvedValue({ data: { outcome }, error: null });
      await expect(
        repository.read("org", {
          actorId: "actor",
          endpoint: "trends",
          filters: {},
        }),
      ).rejects.toBeInstanceOf(DashboardNotFoundError);
    },
  );
  it.each([
    { data: null, error: { private: "secret" } },
    { data: { outcome: "found", result: {} }, error: null },
  ])("sanitizes invalid provider envelopes", async (response) => {
    const { rpc, repository } = setup();
    rpc.mockResolvedValue(response);
    await expect(
      repository.read("org", {
        actorId: "actor",
        endpoint: "trends",
        filters: {},
      }),
    ).rejects.toBeInstanceOf(DashboardUnavailableError);
  });
});
