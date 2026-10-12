import { SupabaseConnectorRepository } from "./supabase-connector.repository";
import type { SupabaseService } from "../../supabase/supabase.service";

describe("connector source-owned list predicates", () => {
  const params = { page: 1, pageSize: 25, order: "desc" as const };
  function fixture() {
    const query = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolve({ data: [], count: 0, error: null })),
    };
    const rpc = jest
      .fn<typeof query, [string, Readonly<Record<string, unknown>>, unknown?]>()
      .mockReturnValue(query);
    const from = jest.fn().mockReturnValue(query);
    const service = {
      admin: () => ({ rpc, from }),
    } as unknown as SupabaseService;
    return { repository: new SupabaseConnectorRepository(service), rpc, query };
  }
  it("uses deterministic registry ties for list/export parity", async () => {
    const f = fixture();
    await f.repository.listConnectors("org-a", params);
    expect(f.query.order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: true }],
    ]);
  });
  it("shares active identity selector and verified connector scope", async () => {
    const f = fixture();
    jest.spyOn(f.repository, "getConnector").mockResolvedValue({});
    await f.repository.listExternalIdentities("org-a", "connector-a", params);
    expect(f.rpc).toHaveBeenCalledWith("m14_03_connector_identity_rows", {
      p_org: "org-a",
      p_connector: "connector-a",
    });
    expect(f.query.order).toHaveBeenCalledWith("id", { ascending: true });
  });
  it("shares run status predicates between rows and counts", async () => {
    const f = fixture();
    jest.spyOn(f.repository, "getConnector").mockResolvedValue({});
    await f.repository.listSyncRuns("org-a", "connector-a", params, "failed");
    expect(
      f.rpc.mock.calls.every((call) => call[1].p_status === "failed"),
    ).toBe(true);
    expect(
      f.rpc.mock.calls.every((call) => call[0] === "m14_03_connector_run_rows"),
    ).toBe(true);
  });
  it("shares verified parent plan and conflict selectors", async () => {
    const f = fixture();
    jest.spyOn(f.repository, "getSyncRun").mockResolvedValue({});
    await f.repository.listSyncRunPlanItems(
      "org-a",
      "connector-a",
      "run-a",
      params,
    );
    await f.repository.listConflictsForRun("org-a", "connector-a", "run-a");
    expect(f.rpc).toHaveBeenCalledWith("m14_03_connector_plan_rows", {
      p_org: "org-a",
      p_run: "run-a",
    });
    expect(f.rpc).toHaveBeenCalledWith("m14_03_connector_conflict_rows", {
      p_org: "org-a",
      p_run: "run-a",
    });
  });
  it("keeps empty page response while sharing the active registry predicate", async () => {
    const f = fixture();
    const page = await f.repository.listConnectors("org-a", params);
    expect(page.rows).toEqual([]);
    expect(f.rpc).toHaveBeenCalledWith(
      "m14_03_connector_registry_rows",
      { p_org: "org-a" },
      { count: "exact", head: true },
    );
  });
});
