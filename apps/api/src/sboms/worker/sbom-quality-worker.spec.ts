import { Logger } from "@nestjs/common";
import {
  SbomQualityWorker,
  type SbomQualityQueue,
} from "./sbom-quality-worker";
import type { BsiProfileFacts } from "../quality/bsi-profile-facts";
import { calculateSbomQuality } from "../quality/sbom-quality-policy";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const reportId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";
type PersistCall = readonly [
  string,
  Readonly<{
    report: Readonly<{
      assessmentStatus: string;
      bsiProfile: Readonly<{ status: string; rulesetVersion: string }>;
      quality: Readonly<{ inputs: Readonly<Record<string, unknown>> }>;
    }>;
    findings: readonly Readonly<{
      kind: string;
      actual: string | null;
      dimension: string | null;
    }>[];
  }>,
];

describe("SbomQualityWorker", () => {
  const queue = queueFor();

  beforeEach(() => jest.resetAllMocks());

  it("claims one quality report per tenant per round before repeating a tenant", async () => {
    queue.dueQualityOrganizationIds.mockResolvedValue([orgA, orgB]);
    queue.claimQualityReport
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValueOnce(claim(orgB))
      .mockResolvedValue({ outcome: "none_available" });
    queue.readQualityFactPage.mockResolvedValue(emptyFacts());

    await subject(queue).runOnce();

    expect(queue.claimQualityReport).toHaveBeenNthCalledWith(
      1,
      orgA,
      expect.any(Object),
    );
    expect(queue.claimQualityReport).toHaveBeenNthCalledWith(
      2,
      orgB,
      expect.any(Object),
    );
    expect(queue.claimQualityReport).toHaveBeenNthCalledWith(
      3,
      orgA,
      expect.any(Object),
    );
    expect(queue.claimQualityReport).toHaveBeenNthCalledWith(
      4,
      orgB,
      expect.any(Object),
    );
    expect(queue.persistQualityReport).toHaveBeenCalledTimes(2);
  });

  it("aggregates component facts across cursor pages and persists deterministic findings", async () => {
    queue.dueQualityOrganizationIds.mockResolvedValue([orgA]);
    queue.claimQualityReport
      .mockResolvedValueOnce(
        claim(orgA, {
          profileEnabled: true,
          baseline: {
            status: "available",
            reportId: "55555555-5555-4555-8555-555555555555",
            sourceId: "66666666-6666-4666-8666-666666666666",
            totalScore: 100,
            completedAt: "2026-08-24T00:00:00.000Z",
            quality: calculateSbomQuality({
              components: [
                {
                  canonicalPurl: "pkg:npm/a@1.0.0",
                  hashes: [{ algorithm: "SHA-256", value: "a".repeat(64) }],
                  supplierValues: ["Supplier"],
                  licenseValues: ["MIT"],
                  depth: 3,
                },
              ],
              primaryComponent: { id: "root", directDependencyCount: 1 },
              maximumDepth: 3,
            }),
          },
        }),
      )
      .mockResolvedValue({ outcome: "none_available" });
    queue.readQualityFactPage
      .mockResolvedValueOnce({
        components: [
          {
            canonicalPurl: "pkg:npm/a@1.0.0",
            hashes: [{ algorithm: "SHA-256", value: "a".repeat(64) }],
            supplierValues: ["Supplier"],
            licenseValues: ["MIT"],
            depth: 1,
          },
        ],
        primaryComponent: null,
        maximumDepth: 1,
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        components: [
          {
            canonicalPurl: null,
            hashes: [{ algorithm: "SHA-256", value: "bad" }],
            supplierValues: ["NOASSERTION"],
            licenseValues: ["NONE"],
            depth: 2,
          },
        ],
        primaryComponent: { id: "root", directDependencyCount: 1 },
        maximumDepth: 2,
        nextCursor: null,
      });

    await subject(queue, { pageSize: 1 }).runOnce();

    expect(queue.readQualityFactPage).toHaveBeenNthCalledWith(
      1,
      orgA,
      expect.objectContaining({ limit: 1, cursor: undefined }),
    );
    expect(queue.readQualityFactPage).toHaveBeenNthCalledWith(
      2,
      orgA,
      expect.objectContaining({ limit: 1, cursor: "cursor-2" }),
    );
    const call = queue.persistQualityReport.mock
      .calls[0] as unknown as PersistCall;
    expect(call[0]).toBe(orgA);
    expect(call[1].report.assessmentStatus).toBe("regression");
    expect(call[1].report.quality.inputs).toMatchObject({
      componentCount: 2,
      componentsWithCanonicalPurl: 1,
      componentsWithValidHash: 1,
      componentsWithSupplier: 1,
      componentsWithLicense: 1,
      primaryComponentDirectDependencyCount: 1,
      maximumDepth: 2,
    });
    expect(call[1].findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "coverage_gap", dimension: "purl" }),
        expect.objectContaining({ kind: "bsi_rule" }),
        expect.objectContaining({ kind: "regression" }),
      ]),
    );
  });

  it.each([
    { enabled: true, ruleset: "bsi-tr-03183-2.v2.0.0", complete: true },
    { enabled: true, ruleset: "bsi-tr-03183-2.v2.0.0", complete: false },
    { enabled: true, ruleset: "bsi-tr-03183-2.v9.0.0", complete: true },
    { enabled: false, ruleset: "bsi-tr-03183-2.v2.0.0", complete: true },
  ])(
    "keeps full-profile availability separate from aggregate quality: %j",
    async ({ enabled, ruleset, complete }) => {
      queue.dueQualityOrganizationIds.mockResolvedValue([orgA]);
      queue.claimQualityReport
        .mockResolvedValueOnce(
          claim(orgA, { profileEnabled: enabled, rulesetVersion: ruleset }),
        )
        .mockResolvedValue({ outcome: "none_available" });
      queue.readQualityFactPage.mockResolvedValue(
        complete
          ? {
              components: [
                {
                  canonicalPurl: "pkg:npm/a@1.0.0",
                  hashes: [{ algorithm: "SHA-256", value: "a".repeat(64) }],
                  supplierValues: ["Supplier"],
                  licenseValues: ["MIT"],
                  depth: 3,
                },
              ],
              primaryComponent: { id: "root", directDependencyCount: 1 },
              maximumDepth: 3,
              nextCursor: null,
            }
          : emptyFacts(),
      );
      await subject(queue).runOnce();
      const call = queue.persistQualityReport.mock
        .calls[0] as unknown as PersistCall;
      expect(call[0]).toBe(orgA);
      expect(call[1].report.assessmentStatus).toBe(
        enabled || !complete ? "warning" : "first_document",
      );
      expect(call[1].report.bsiProfile).toMatchObject({
        status: enabled ? "unavailable" : "disabled",
        rulesetVersion: ruleset,
      });
      expect(
        call[1].findings.some(
          (finding) =>
            finding.kind === "bsi_rule" &&
            finding.actual === "Full pinned BSI profile not evaluated",
        ),
      ).toBe(enabled);
    },
  );

  it("evaluates verified original facts and preserves quality when source access fails", async () => {
    queue.dueQualityOrganizationIds.mockResolvedValue([orgA]);
    queue.claimQualityReport
      .mockResolvedValueOnce(claim(orgA, { profileEnabled: true }))
      .mockResolvedValue({ outcome: "none_available" });
    queue.readQualityFactPage.mockResolvedValue(emptyFacts());
    const reader = {
      read: jest.fn().mockResolvedValue({
        facts: completeFacts(),
        sourceSha256: "a".repeat(64),
      }),
    };
    await subject(queue, { bsiEvidenceReader: reader }).runOnce();
    expect(reader.read).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        reportId,
        documentId,
        sourceId: "88888888-8888-4888-8888-888888888888",
      }),
    );
    expect(queue.persistQualityReport).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        report: expect.objectContaining({
          bsiProfile: expect.objectContaining({
            status: "warning",
            assessmentKind: "pinned_technical_checks",
            sourceSha256: "a".repeat(64),
            failedRuleCount: 0,
          }) as unknown,
        }) as unknown,
      }),
    );
    queue.claimQualityReport.mockResolvedValueOnce(
      claim(orgA, { profileEnabled: true }),
    );
    const warning = jest.spyOn(Logger.prototype, "warn");
    reader.read.mockRejectedValue(
      new Error("private raw source token=do-not-log"),
    );
    await subject(queue, { bsiEvidenceReader: reader }).runOnce();
    expect(queue.persistQualityReport).toHaveBeenLastCalledWith(
      orgA,
      expect.objectContaining({
        report: expect.objectContaining({
          bsiProfile: expect.objectContaining({
            status: "unavailable",
            assessmentKind: "unavailable",
          }) as unknown,
        }) as unknown,
      }),
    );
    expect(warning).toHaveBeenCalledWith({
      message: "Pinned BSI technical checks unavailable",
      code: "bsi_profile_unavailable",
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("do-not-log");
    warning.mockRestore();
    expect(queue.failQualityReport).not.toHaveBeenCalled();
  });

  it.each([
    { enabled: false, validHash: true, badFacts: false, expected: "disabled" },
    {
      enabled: true,
      validHash: false,
      badFacts: false,
      expected: "unavailable",
    },
    { enabled: true, validHash: true, badFacts: true, expected: "invalid" },
  ])(
    "keeps original-read eligibility and normative errors explicit: %j",
    async ({ enabled, validHash, badFacts, expected }) => {
      queue.dueQualityOrganizationIds.mockResolvedValue([orgA]);
      queue.claimQualityReport
        .mockResolvedValueOnce(claim(orgA, { profileEnabled: enabled }))
        .mockResolvedValue({ outcome: "none_available" });
      queue.readQualityFactPage.mockResolvedValue(emptyFacts());
      const reader = {
        read: jest.fn().mockResolvedValue({
          facts: {
            ...completeFacts(),
            embeddedVulnerabilityInformation: badFacts,
          },
          sourceSha256: validHash ? "a".repeat(64) : "unverified",
        }),
      };
      await subject(queue, { bsiEvidenceReader: reader }).runOnce();
      const call = queue.persistQualityReport.mock
        .calls[0] as unknown as PersistCall;
      expect(call[1].report.bsiProfile.status).toBe(expected);
      if (enabled) expect(reader.read).toHaveBeenCalledTimes(1);
      else expect(reader.read).not.toHaveBeenCalled();
      if (badFacts) expect(call[1].report.assessmentStatus).toBe("invalid");
    },
  );

  it.each([
    { workerId: "invalid" },
    { leaseSeconds: 14 },
    { leaseSeconds: 901 },
    { pageSize: 0 },
    { pageSize: 5001 },
    { maximumComponents: 0 },
  ])(
    "rejects invalid configured bounds before taking a lease: %j",
    (options) => {
      expect(() => subject(queue, options)).toThrow(
        /invalid sbom quality worker/,
      );
      expect(queue.claimQualityReport).not.toHaveBeenCalled();
    },
  );

  it("fails the leased report durably when fact loading or scoring fails", async () => {
    queue.dueQualityOrganizationIds.mockResolvedValue([orgA]);
    queue.claimQualityReport
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    queue.readQualityFactPage.mockRejectedValue(new Error("db timeout"));

    await subject(queue).runOnce();

    expect(queue.failQualityReport).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        reportId,
        errorCode: "provider_unavailable",
      }),
    );
    expect(queue.persistQualityReport).not.toHaveBeenCalled();
  });
});

function subject(
  queue: SbomQualityQueue,
  overrides: Partial<ConstructorParameters<typeof SbomQualityWorker>[0]> = {},
) {
  return new SbomQualityWorker({
    workerId: "77777777-7777-4777-8777-777777777777",
    leaseSeconds: 60,
    queue,
    ...overrides,
  });
}

function queueFor() {
  return {
    dueQualityOrganizationIds: jest.fn(),
    claimQualityReport: jest.fn(),
    readQualityFactPage: jest.fn(),
    persistQualityReport: jest.fn(),
    failQualityReport: jest.fn(),
  } satisfies Record<keyof SbomQualityQueue, jest.Mock>;
}

function claim(
  organizationId: string,
  overrides: Partial<
    Extract<
      Awaited<ReturnType<SbomQualityQueue["claimQualityReport"]>>,
      { outcome: "claimed" }
    >
  > = {},
) {
  return {
    outcome: "claimed" as const,
    organizationId,
    reportId,
    sourceId: "88888888-8888-4888-8888-888888888888",
    releaseId: "99999999-9999-4999-8999-999999999999",
    documentId,
    profileEnabled: false,
    rulesetVersion: "bsi-tr-03183-2.v2.0.0",
    configurationVersion: 1,
    baseline: { status: "first_document" as const },
    ...overrides,
  };
}

function emptyFacts() {
  return {
    components: [],
    primaryComponent: null,
    maximumDepth: 0,
    nextCursor: null,
  };
}

function completeFacts(): BsiProfileFacts {
  return {
    format: "cyclonedx",
    specificationVersion: "1.6",
    serialization: "json",
    creatorContacts: ["author@example.test"],
    timestamp: "2026-09-28T00:00:00Z",
    documentUri: "https://example.test/bom",
    primaryComponentReference: "root",
    embeddedVulnerabilityInformation: false,
    externalBomLinks: [],
    limitations: [],
    components: [
      {
        reference: "root",
        sourcePath: "$.metadata.component",
        creatorContacts: ["https://example.test"],
        name: "Example",
        version: "1.0",
        filename: "example.bin",
        sha512: ["a".repeat(128)],
        dependencies: [],
        associatedLicenses: ["MIT"],
        concludedLicenses: [],
        declaredLicenses: [],
        executable: true,
        archive: false,
        structured: false,
        sourceCodeUris: [],
        deployableUris: [],
        identifiers: [],
        inDeliveryScope: true,
        unavailableFields: [],
      },
    ],
  };
}
