import { SupabaseSbomRepository } from "./supabase-sbom.repository";
import { SupabaseService } from "../../supabase/supabase.service";
const org = "00000000-0000-4000-8000-000000000001",
  actor = "00000000-0000-4000-8000-000000000002",
  diff = "00000000-0000-4000-8000-000000000003";
describe("live finding delta wire translation", () => {
  function adapter(state: string, items: unknown[] = []) {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "found", result: { state, items, nextCursor: null } }],
      error: null,
    });
    return {
      repository: new SupabaseSbomRepository({
        admin: () => ({ rpc }),
      } as unknown as SupabaseService),
      rpc,
    };
  }
  it("translates completed M4 projections to available and retains exact scope", async () => {
    const { repository, rpc } = adapter("ready", [
      {
        findingId: actor,
        change: "new",
        origin: "advisory_reevaluation",
        explanation: "Current document only",
      },
    ]);
    await expect(
      repository.getFindingDelta(org, {
        actorId: actor,
        diffId: diff,
        limit: 50,
      }),
    ).resolves.toMatchObject({
      status: "available",
      findings: [{ findingId: actor }],
      reason: null,
    });
    expect(rpc).toHaveBeenCalledWith("get_sbom_diff_findings", {
      p_organization_id: org,
      p_actor_user_id: actor,
      p_report_id: diff,
      p_limit: 50,
      p_cursor: null,
    });
  });
  it("reports unavailable matching without claiming an empty completed comparison", async () => {
    await expect(
      adapter("partial_integration_unavailable").repository.getFindingDelta(
        org,
        { actorId: actor, diffId: diff, limit: 50 },
      ),
    ).resolves.toMatchObject({
      status: "partial_integration_unavailable",
      reason:
        "Finding delta is unavailable until matching completes for both scoped documents.",
    });
  });
  it("rejects unknown provider states and malformed rows", async () => {
    await expect(
      adapter("unknown").repository.getFindingDelta(org, {
        actorId: actor,
        diffId: diff,
        limit: 50,
      }),
    ).rejects.toThrow();
    await expect(
      adapter("ready", [{}]).repository.getFindingDelta(org, {
        actorId: actor,
        diffId: diff,
        limit: 50,
      }),
    ).rejects.toThrow();
  });
});
