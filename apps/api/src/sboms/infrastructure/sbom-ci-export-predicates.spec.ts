import { SupabaseSbomRepository } from "./supabase-sbom.repository";
import type { SupabaseService } from "../../supabase/supabase.service";
const org = "8cc33f37-0297-4327-aa68-8a11c557fe7a";
describe("shared source-owned CI list predicates", () => {
  function fixture() {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    const repo = new SupabaseSbomRepository({
      admin: () => ({
        rpc,
        from: () => {
          throw new Error("duplicated table predicate");
        },
      }),
    } as unknown as SupabaseService);
    return { rpc, repo };
  }
  it("keeps the screen binding limit while using the export source predicate", async () => {
    const { repo, rpc } = fixture();
    expect(await repo.listBindings(org)).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("m14_03_sbom_ci_binding_rows", {
      p_organization_id: org,
      p_limit: 100,
      p_cursor: null,
    });
  });
  it("pages credentials with the same predicate without a silent screen cap", async () => {
    const { repo, rpc } = fixture();
    expect(await repo.list(org)).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("m14_03_sbom_ci_credential_rows", {
      p_organization_id: org,
      p_limit: 100,
      p_cursor: null,
    });
  });
  it("preserves bounded build run reads and empty results", async () => {
    const { repo, rpc } = fixture();
    jest.spyOn(repo, "getBinding").mockResolvedValue({ id: org } as never);
    expect(await repo.listBuildRuns(org, org, 300)).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("m14_03_sbom_ci_build_run_rows", {
      p_organization_id: org,
      p_binding_id: org,
      p_limit: 50,
      p_cursor: null,
    });
  });
});
