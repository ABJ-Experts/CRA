import {
  renderCompositeCycloneDx,
  SbomCompositeWorker,
} from "./sbom-composite-worker";

const ids = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  reviewId: "00000000-0000-4000-8000-000000000002",
  actorId: "00000000-0000-4000-8000-000000000003",
  productId: "00000000-0000-4000-8000-000000000004",
  releaseId: "00000000-0000-4000-8000-000000000005",
  sourceId: "00000000-0000-4000-8000-000000000006",
  workerId: "00000000-0000-4000-8000-000000000007",
};

const claim = {
  outcome: "claimed" as const,
  organizationId: ids.organizationId,
  reviewId: ids.reviewId,
  actorId: ids.actorId,
  productId: ids.productId,
  releaseId: ids.releaseId,
  mergeRulesVersion: "sbom-composite.v1",
  generatedSourceId: null,
  components: [
    {
      componentRef: "document-b:component-b",
      name: "beta",
      version: "2.0.0",
      canonicalPurl: "pkg:npm/beta@2.0.0",
      canonicalCpe: null,
      hashes: [{ algorithm: "SHA-256", value: "b".repeat(64) }],
    },
    {
      componentRef: "document-a:component-a",
      name: "alpha",
      version: "1.0.0",
      canonicalPurl: "pkg:npm/alpha@1.0.0",
      canonicalCpe: "cpe:2.3:a:acme:alpha:1.0.0:*:*:*:*:*:*:*",
      hashes: [{ algorithm: "SHA-256", value: "a".repeat(64) }],
    },
  ],
  dependencies: [
    { fromRef: "document-a:component-a", toRef: "document-b:component-b" },
  ],
};

describe("SbomCompositeWorker", () => {
  it("renders source-order-independent canonical CycloneDX", () => {
    const document = renderCompositeCycloneDx(claim);
    expect(
      document.components.map((component) => component["bom-ref"]),
    ).toEqual(["document-a:component-a", "document-b:component-b"]);
    expect(document.dependencies).toEqual([
      {
        ref: "document-a:component-a",
        dependsOn: ["document-b:component-b"],
      },
    ]);
    expect(document.components[0]).toMatchObject({
      cpe: "cpe:2.3:a:acme:alpha:1.0.0:*:*:*:*:*:*:*",
    });
    expect(document.components[1]).not.toHaveProperty("cpe");
  });

  it("writes an immutable generated source and re-enters ordinary intake", async () => {
    const queue = queueFor(claim);
    const intake = {
      initialize: jest.fn().mockResolvedValue({
        ok: true,
        value: {
          reservation: {
            id: ids.sourceId,
            objectKey: `${ids.organizationId}/${ids.sourceId}/${"a".repeat(64)}`,
            mediaType: "application/vnd.cyclonedx+json",
          },
        },
      }),
      complete: jest
        .fn()
        .mockResolvedValue({ ok: true, value: { job: { id: "job" } } }),
    };
    const storage = {
      writeImmutable: jest.fn().mockResolvedValue({ outcome: "written" }),
    };

    await worker(queue, intake, storage).runOnce();

    expect(storage.writeImmutable).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: `${ids.organizationId}/${ids.sourceId}/${"a".repeat(64)}`,
        contentType: "application/vnd.cyclonedx+json",
      }),
    );
    expect(intake.complete).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: ids.sourceId }),
    );
    expect(queue.attachGeneratedSource).toHaveBeenCalledWith(
      ids.organizationId,
      {
        reviewId: ids.reviewId,
        workerId: ids.workerId,
        sourceId: ids.sourceId,
      },
    );
    expect(queue.reconcileCompositeGeneration).toHaveBeenCalled();
  });

  it("survives a restart after immutable bytes have already been written", async () => {
    const queue = queueFor(claim);
    const intake = {
      initialize: jest.fn().mockResolvedValue({
        ok: true,
        value: {
          reservation: {
            id: ids.sourceId,
            objectKey: `${ids.organizationId}/${ids.sourceId}/${"a".repeat(64)}`,
            mediaType: "application/vnd.cyclonedx+json",
          },
        },
      }),
      complete: jest
        .fn()
        .mockResolvedValue({ ok: true, value: { job: { id: "job" } } }),
    };
    const storage = {
      writeImmutable: jest
        .fn()
        .mockResolvedValue({ outcome: "already_exists" }),
    };

    await worker(queue, intake, storage).runOnce();

    expect(intake.complete).toHaveBeenCalledTimes(1);
    expect(queue.failCompositeGeneration).not.toHaveBeenCalled();
  });

  it("only reconciles after a generated source was durably attached", async () => {
    const queue = queueFor({ ...claim, generatedSourceId: ids.sourceId });
    const intake = {
      initialize: jest.fn(),
      complete: jest.fn(),
    };
    const storage = { writeImmutable: jest.fn() };

    await worker(queue, intake, storage).runOnce();

    expect(intake.initialize).not.toHaveBeenCalled();
    expect(storage.writeImmutable).not.toHaveBeenCalled();
    expect(queue.attachGeneratedSource).not.toHaveBeenCalled();
    expect(queue.reconcileCompositeGeneration).toHaveBeenCalledWith(
      ids.organizationId,
      { reviewId: ids.reviewId, workerId: ids.workerId },
    );
  });
});

function worker(
  queue: ReturnType<typeof queueFor>,
  intake: { initialize: jest.Mock; complete: jest.Mock },
  storage: { writeImmutable: jest.Mock },
) {
  return new SbomCompositeWorker({
    workerId: ids.workerId,
    leaseSeconds: 60,
    queue,
    intake,
    storage,
  });
}

function queueFor(
  work: Omit<typeof claim, "generatedSourceId"> & {
    generatedSourceId: string | null;
  },
) {
  const claimCompositeGeneration = jest
    .fn()
    .mockResolvedValueOnce(work)
    .mockResolvedValue({ outcome: "none_available" });
  return {
    dueCompositeOrganizationIds: jest
      .fn()
      .mockResolvedValue([ids.organizationId]),
    claimCompositeGeneration,
    attachGeneratedSource: jest.fn().mockResolvedValue(undefined),
    reconcileCompositeGeneration: jest.fn().mockResolvedValue(undefined),
    failCompositeGeneration: jest.fn().mockResolvedValue(undefined),
  };
}
