import { EvidenceReuseValidityUseCases } from "./evidence-reuse-validity-use-cases";

describe("EvidenceReuseValidityUseCases", () => {
  const repository = {
    reuse: jest.fn(),
    expiryAlertIntervals: jest.fn(),
    updateExpiryAlertIntervals: jest.fn(),
  };

  beforeEach(() => jest.resetAllMocks());

  it("keeps reverse-link reads tenant and actor scoped", async () => {
    repository.reuse.mockResolvedValue({
      reuse: { technicalFileLinks: [], frameworkControls: [] },
    });
    const useCases = new EvidenceReuseValidityUseCases(repository);

    await expect(
      useCases.reuse({
        organizationId: "org",
        actorId: "actor",
        productId: "product",
        documentId: "document",
        versionId: "version",
      }),
    ).resolves.toEqual({
      reuse: { technicalFileLinks: [], frameworkControls: [] },
    });
    expect(repository.reuse).toHaveBeenCalledWith("org", {
      actorId: "actor",
      productId: "product",
      documentId: "document",
      versionId: "version",
    });
  });

  it("uses the durable interval update boundary without dropping optimistic versioning", async () => {
    repository.updateExpiryAlertIntervals.mockResolvedValue({
      outcome: "updated",
      value: {
        expiryAlertIntervals: {
          thresholdDays: [30],
          version: 2,
          updatedAt: "2026-09-18T10:00:00.000Z",
          updatedByUserId: null,
        },
      },
    });
    const useCases = new EvidenceReuseValidityUseCases(repository);

    await expect(
      useCases.updateExpiryAlertIntervals({
        organizationId: "org",
        actorId: "actor",
        input: {
          thresholdDays: [30],
          expectedVersion: 1,
          idempotencyKey: "00000000-0000-4000-8000-000000000001",
        },
      }),
    ).resolves.toEqual({
      outcome: "updated",
      value: {
        expiryAlertIntervals: {
          thresholdDays: [30],
          version: 2,
          updatedAt: "2026-09-18T10:00:00.000Z",
          updatedByUserId: null,
        },
      },
    });
    expect(repository.updateExpiryAlertIntervals).toHaveBeenCalledWith("org", {
      actorId: "actor",
      input: {
        thresholdDays: [30],
        expectedVersion: 1,
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      },
    });
  });
});
