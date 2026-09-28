import { SupabaseService } from "../../supabase/supabase.service";
import { calculateSbomQuality } from "../quality/sbom-quality-policy";
import { SupabaseSbomRepository } from "./supabase-sbom.repository";

type PersistedFinding = Readonly<{ finding_key: string }>;

function persistedFindings(
  call: ReadonlyArray<unknown> | undefined,
): readonly PersistedFinding[] {
  const payload = call?.[1];
  if (!payload || typeof payload !== "object" || !("p_findings" in payload)) {
    throw new Error("Expected persisted findings payload");
  }
  return (payload as { p_findings: readonly PersistedFinding[] }).p_findings;
}

describe("quality finding persistence identity", () => {
  it("keeps the same profile rule on different source components distinct across retries", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: [{ outcome: "completed" }], error: null });
    const repository = new SupabaseSbomRepository({
      admin: () => ({ rpc }),
    } as unknown as SupabaseService);
    const input = {
      reportId: "11111111-1111-4111-8111-111111111111",
      workerId: "22222222-2222-4222-8222-222222222222",
      report: {
        assessmentStatus: "invalid" as const,
        quality: calculateSbomQuality({
          components: [],
          primaryComponent: null,
          maximumDepth: 0,
        }),
        bsiProfile: {
          enabled: true,
          status: "invalid" as const,
          rulesetVersion: "bsi-tr-03183-2.v2.0.0",
          findingCount: 2,
        },
        baseline: { status: "first_document" as const },
        regression: {
          status: "none" as const,
          totalScoreDelta: 0,
          changedDimensions: [],
          materialDimensionIds: [],
        },
      },
      findings: ["$.components[0]", "$.components[1]", "$", "$"].map(
        (sourcePath, index) => ({
          kind: "bsi_rule" as const,
          code: "BSI-2.0.0-5.2.2-CREATOR",
          ruleId: "BSI-2.0.0-5.2.2-CREATOR",
          severity: "error" as const,
          dimension: null,
          componentId: null,
          sourcePath,
          expected: "Native creator",
          actual: index < 2 ? "Missing" : `Ambiguity ${index}`,
          remediation: "Review source metadata.",
        }),
      ),
    };
    await repository.persistQualityReport(
      "33333333-3333-4333-8333-333333333333",
      input,
    );
    await repository.persistQualityReport(
      "33333333-3333-4333-8333-333333333333",
      input,
    );
    const calls = rpc.mock.calls as readonly (readonly unknown[])[];
    const first = persistedFindings(calls[0]);
    const second = persistedFindings(calls[1]);
    expect(new Set(first.map((finding) => finding.finding_key)).size).toBe(4);
    expect(first.every((finding) => finding.finding_key.length <= 256)).toBe(
      true,
    );
    expect(second.map((finding) => finding.finding_key)).toEqual(
      first.map((finding) => finding.finding_key),
    );
  });
});
