import { SbomDiffWorker, type SbomDiffQueue } from "./sbom-diff-worker";

const organizationId = "00000000-0000-4000-8000-000000000001";
const reportId = "00000000-0000-4000-8000-000000000002";
const currentDocumentId = "00000000-0000-4000-8000-000000000003";
const baselineDocumentId = "00000000-0000-4000-8000-000000000004";
const currentSourceId = "00000000-0000-4000-8000-000000000005";
const baselineSourceId = "00000000-0000-4000-8000-000000000006";

describe("SbomDiffWorker", () => {
  it("persists exact versions as unchanged and leaves version ordering unresolved without M4", async () => {
    const queue = queueFor();
    queue.dueDiffOrganizationIds.mockResolvedValue([organizationId]);
    queue.claimDiffReport
      .mockResolvedValueOnce(claim())
      .mockResolvedValue({ outcome: "none_available" });
    queue.readDiffFactPage.mockImplementation((_organizationId, input) =>
      Promise.resolve(
        input.side === "current"
          ? page([
              fact(
                "00000000-0000-4000-8000-000000000010",
                "pkg:npm/a",
                "1.0.0",
                1,
              ),
              fact(
                "00000000-0000-4000-8000-000000000011",
                "pkg:npm/b",
                "2.0.0",
                2,
              ),
            ])
          : page([
              fact(
                "00000000-0000-4000-8000-000000000012",
                "pkg:npm/a",
                "1.0.0",
                1,
              ),
              fact(
                "00000000-0000-4000-8000-000000000013",
                "pkg:npm/b",
                "1.0.0",
                2,
              ),
            ]),
      ),
    );

    await worker(queue).runOnce();

    const batch = persistedBatch(queue);
    expect(batch.complete).toBe(true);
    expect(batch.changes).toContainEqual(
      expect.objectContaining({
        changeType: "unchanged",
        identity: "pkg:npm/a",
      }),
    );
    const changedVersion = batch.changes.find(
      (change) => change.identity === "pkg:npm/b",
    );
    expect(changedVersion).toMatchObject({ changeType: "unresolved" });
    expect(changedVersion?.explanation).toContain("M4 comparator");
  });

  it("retains duplicate canonical identities as unresolved instead of choosing a component", async () => {
    const queue = queueFor();
    queue.dueDiffOrganizationIds.mockResolvedValue([organizationId]);
    queue.claimDiffReport
      .mockResolvedValueOnce(claim())
      .mockResolvedValue({ outcome: "none_available" });
    queue.readDiffFactPage.mockImplementation((_organizationId, input) =>
      Promise.resolve(
        input.side === "current"
          ? page([
              fact(
                "00000000-0000-4000-8000-000000000010",
                "pkg:npm/a",
                "1.0.0",
                1,
              ),
              fact(
                "00000000-0000-4000-8000-000000000011",
                "pkg:npm/a",
                "1.0.0",
                2,
              ),
            ])
          : page([
              fact(
                "00000000-0000-4000-8000-000000000012",
                "pkg:npm/a",
                "1.0.0",
                1,
              ),
            ]),
      ),
    );

    await worker(queue).runOnce();

    const [unresolved] = persistedBatch(queue).changes;
    expect(unresolved).toMatchObject({ changeType: "unresolved" });
    expect(unresolved?.explanation).toContain("Multiple components");
  });

  it("keeps PURL qualifiers and subpaths identity-significant in stable byte order", async () => {
    const queue = queueFor();
    queue.dueDiffOrganizationIds.mockResolvedValue([organizationId]);
    queue.claimDiffReport
      .mockResolvedValueOnce(claim())
      .mockResolvedValue({ outcome: "none_available" });
    queue.readDiffFactPage.mockImplementation((_organizationId, input) =>
      Promise.resolve(
        input.side === "current"
          ? page([
              fact(
                "00000000-0000-4000-8000-000000000020",
                "pkg:npm/a?arch=x",
                "1.0.0",
                1,
              ),
            ])
          : page([
              fact(
                "00000000-0000-4000-8000-000000000021",
                "pkg:npm/a#src",
                "1.0.0",
                1,
              ),
            ]),
      ),
    );

    await worker(queue).runOnce();

    expect(persistedBatch(queue).changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          changeType: "removed",
          identity: "pkg:npm/a#src",
        }),
        expect.objectContaining({
          changeType: "added",
          identity: "pkg:npm/a?arch=x",
        }),
      ]),
    );
  });

  it("fails the leased report rather than exposing a partial graph when a fact page cannot load", async () => {
    const queue = queueFor();
    queue.dueDiffOrganizationIds.mockResolvedValue([organizationId]);
    queue.claimDiffReport
      .mockResolvedValueOnce(claim())
      .mockResolvedValue({ outcome: "none_available" });
    queue.readDiffFactPage.mockRejectedValue(new Error("statement timeout"));

    await worker(queue).runOnce();

    expect(queue.failDiffReport.mock.calls).toContainEqual([
      organizationId,
      expect.objectContaining({
        reportId,
        errorCode: "diff_statement_timeout",
      }),
    ]);
    expect(queue.persistDiffBatch.mock.calls).toHaveLength(0);
  });
});

function worker(queue: SbomDiffQueue) {
  return new SbomDiffWorker({
    workerId: "00000000-0000-4000-8000-000000000007",
    leaseSeconds: 60,
    queue,
    pageSize: 25,
    batchSize: 25,
  });
}

function queueFor(): jest.Mocked<SbomDiffQueue> {
  return {
    dueDiffOrganizationIds: jest.fn(),
    claimDiffReport: jest.fn(),
    readDiffFactPage: jest.fn(),
    persistDiffBatch: jest.fn().mockResolvedValue(undefined),
    failDiffReport: jest.fn().mockResolvedValue(undefined),
  };
}

function persistedBatch(queue: jest.Mocked<SbomDiffQueue>) {
  const call = queue.persistDiffBatch.mock.calls[0];
  if (!call) throw new Error("Expected a persisted diff batch");
  return call[1];
}

function claim() {
  return {
    outcome: "claimed" as const,
    organizationId,
    reportId,
    sourceId: currentSourceId,
    baselineSourceId,
    documentId: currentDocumentId,
    baselineDocumentId,
    checkpoint: {},
  };
}

function page(facts: readonly ReturnType<typeof fact>[]) {
  return { facts, nextCursor: null };
}

function fact(
  componentId: string,
  identity: string | null,
  normalizedVersion: string | null,
  sourceOffset: number,
) {
  return {
    componentId,
    identity,
    ecosystem: "npm",
    canonicalPurl:
      identity === null ? null : `${identity}@${normalizedVersion}`,
    normalizedVersion,
    sourceOffset,
  };
}
