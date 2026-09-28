import { createM4SbomDiffVersionComparator } from "../infrastructure/m4-sbom-diff-version-comparator";
import { SbomDiffWorker, type SbomDiffQueue } from "./sbom-diff-worker";
const org = "00000000-0000-4000-8000-000000000001",
  report = "00000000-0000-4000-8000-000000000002",
  current = "00000000-0000-4000-8000-000000000003",
  baseline = "00000000-0000-4000-8000-000000000004";
async function run(
  ecosystem: string | null,
  left: string | null,
  right: string | null,
  policyVersion = "m3-m4-version-comparators.v1",
) {
  const queue: jest.Mocked<SbomDiffQueue> = {
    dueDiffOrganizationIds: jest.fn().mockResolvedValue([org]),
    claimDiffReport: jest
      .fn()
      .mockResolvedValueOnce({
        outcome: "claimed",
        organizationId: org,
        reportId: report,
        sourceId: current,
        baselineSourceId: baseline,
        documentId: current,
        baselineDocumentId: baseline,
        comparatorVersion: policyVersion,
        checkpoint: {},
      })
      .mockResolvedValue({ outcome: "none_available" }),
    readDiffFactPage: jest
      .fn()
      .mockImplementation(
        (
          _org: string,
          input: Parameters<SbomDiffQueue["readDiffFactPage"]>[1],
        ) =>
          Promise.resolve({
            facts: [
              {
                componentId: input.side === "current" ? current : baseline,
                identity: "pkg:npm/a",
                ecosystem,
                canonicalPurl: null,
                normalizedVersion: input.side === "current" ? left : right,
                sourceOffset: 0,
              },
            ],
            nextCursor: null,
          }),
      ),
    persistDiffBatch: jest.fn(),
    failDiffReport: jest.fn(),
  };
  await new SbomDiffWorker({
    workerId: report,
    leaseSeconds: 60,
    queue,
    versionComparator: createM4SbomDiffVersionComparator(),
  }).runOnce();
  return queue;
}
describe("installed M4 lineage comparator", () => {
  it.each([
    ["npm", "2.0.0", "1.0.0", "upgraded"],
    ["npm", "1.0.0", "2.0.0", "downgraded"],
    ["maven", "1.0", "1.0.0", "unchanged"],
    ["pypi", "1.0rc1", "1.0", "downgraded"],
    ["deb", "1:1.0-1", "1.0-9", "upgraded"],
    ["rpm", "1.0a-1", "1.0.1-1", "downgraded"],
    ["golang", "v1.1.0", "v1.0.0", "upgraded"],
    ["unknown", "2", "1", "unresolved"],
    ["npm", "bad", "1.0.0", "unresolved"],
  ])("%s %s/%s -> %s", async (ecosystem, left, right, changeType) => {
    const queue = await run(ecosystem, left, right);
    expect(queue.failDiffReport.mock.calls).toHaveLength(0);
    expect(
      queue.persistDiffBatch.mock.calls.flatMap((call) => call[1].changes),
    ).toContainEqual(expect.objectContaining({ changeType }));
  });
  it.each(["npm", "maven", "pypi", "golang"])(
    "leaves unsafe numeric runs unresolved for %s",
    async (ecosystem) => {
      const queue = await run(
        ecosystem,
        "9007199254740993.0.0",
        "9007199254740992.0.0",
      );
      expect(
        queue.persistDiffBatch.mock.calls[0]?.[1].changes[0]?.changeType,
      ).toBe("unresolved");
    },
  );
  it.each(["deb", "rpm"])(
    "leaves unsafe epochs unresolved for %s",
    async (ecosystem) => {
      const queue = await run(
        ecosystem,
        "9007199254740993:1.0",
        "9007199254740992:1.0",
      );
      expect(
        queue.persistDiffBatch.mock.calls[0]?.[1].changes[0]?.changeType,
      ).toBe("unresolved");
    },
  );
  it("accepts the largest safe integer run", () => {
    expect(
      createM4SbomDiffVersionComparator().compare(
        "npm",
        "9007199254740991.0.0",
        "1.0.0",
      ),
    ).toEqual({ kind: "comparable", ordering: 1 });
  });
  it.each([
    [null, "1.0.0"],
    ["1.0.0", null],
    [null, null],
    ["", ""],
  ])("leaves missing versions review-required", async (left, right) => {
    const queue = await run("npm", left, right);
    expect(
      queue.persistDiffBatch.mock.calls[0]?.[1].changes[0]?.changeType,
    ).toBe("unresolved");
  });
  it("preserves completed-policy provenance for a resumed legacy report", async () => {
    const queue = await run("npm", "2.0.0", "1.0.0", "m4-unavailable.v1");
    expect(
      queue.persistDiffBatch.mock.calls[0]?.[1].changes[0]?.changeType,
    ).toBe("unresolved");
  });
  it("validates worker identity, lease and bounded batches", () => {
    const queue = {} as SbomDiffQueue;
    const base = { workerId: report, leaseSeconds: 60, queue };
    expect(() => new SbomDiffWorker({ ...base, workerId: "invalid" })).toThrow(
      "invalid sbom diff worker id",
    );
    expect(() => new SbomDiffWorker({ ...base, leaseSeconds: 1 })).toThrow(
      "invalid sbom diff worker lease",
    );
    expect(() => new SbomDiffWorker({ ...base, batchSize: 5001 })).toThrow(
      "invalid sbom diff worker bounds",
    );
  });
  it("does not order unknown ecosystems", async () => {
    const queue = await run(null, "2.0.0", "1.0.0");
    expect(
      queue.persistDiffBatch.mock.calls[0]?.[1].changes[0]?.changeType,
    ).toBe("unresolved");
  });
  it("rejects an unknown policy instead of recording a false comparator version", async () => {
    const queue = await run("npm", "2.0.0", "1.0.0", "future.v1");
    expect(queue.failDiffReport.mock.calls.length).toBeGreaterThan(0);
    expect(queue.persistDiffBatch.mock.calls).toHaveLength(0);
  });
});
