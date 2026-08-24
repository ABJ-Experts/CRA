import {
  calculateSbomQuality,
  compareSbomQuality,
  evaluateBsiTr03183_2,
  isRecognizedCryptographicHash,
} from "./sbom-quality-policy";

describe("SBOM quality policy", () => {
  it("keeps the legal top-level floor explicit and scores depth separately", () => {
    const quality = calculateSbomQuality({
      components: [
        {
          canonicalPurl: "pkg:npm/example@1.0.0",
          hashes: [{ algorithm: "SHA-256", value: "a".repeat(64) }],
          supplierValues: ["Example Inc."],
          licenseValues: ["MIT"],
          depth: 0,
        },
      ],
      primaryComponent: { id: "root", directDependencyCount: 1 },
      maximumDepth: 1,
    });

    expect(quality.dimensions).toContainEqual(
      expect.objectContaining({
        id: "top_level_dependency",
        score: 100,
        status: "complete",
      }),
    );
    expect(quality.dimensions).toContainEqual(
      expect.objectContaining({
        id: "transitive_depth",
        score: 33.33,
        status: "partial",
      }),
    );
  });

  it("does not count malformed or weakly-described hashes as cryptographic coverage", () => {
    expect(isRecognizedCryptographicHash("SHA-256", "a".repeat(64))).toBe(true);
    expect(isRecognizedCryptographicHash("SHA-256", "a".repeat(63))).toBe(
      false,
    );
    expect(isRecognizedCryptographicHash("MD5", "a".repeat(32))).toBe(false);

    const quality = calculateSbomQuality({
      components: [
        {
          canonicalPurl: null,
          hashes: [{ algorithm: "SHA-256", value: "invalid" }],
          supplierValues: ["NOASSERTION"],
          licenseValues: ["NONE"],
          depth: 0,
        },
      ],
      primaryComponent: null,
    });

    expect(quality.inputs.componentsWithValidHash).toBe(0);
    expect(quality.inputs.componentsWithSupplier).toBe(0);
    expect(quality.inputs.componentsWithLicense).toBe(0);
  });

  it("treats exact regression thresholds as non-regressions and lower values as warnings", () => {
    const baseline = calculateSbomQuality({
      components: Array.from({ length: 10 }, () => ({
        canonicalPurl: "pkg:npm/example@1.0.0",
        hashes: [{ algorithm: "SHA-256", value: "a".repeat(64) }],
        supplier: "Example Inc.",
        licenseExpression: "MIT",
        depth: 3,
      })),
      primaryComponent: { id: "root", directDependencyCount: 1 },
      maximumDepth: 3,
    });
    const atBoundary = {
      ...baseline,
      totalScore: baseline.totalScore - 5,
      dimensions: baseline.dimensions.map((dimension) =>
        dimension.id === "purl"
          ? { ...dimension, score: dimension.score - 10 }
          : dimension,
      ),
    };
    const beyondBoundary = {
      ...atBoundary,
      totalScore: atBoundary.totalScore - 0.01,
      dimensions: atBoundary.dimensions.map((dimension) =>
        dimension.id === "purl"
          ? { ...dimension, score: dimension.score - 0.01 }
          : dimension,
      ),
    };

    expect(compareSbomQuality(atBoundary, baseline).status).toBe("none");
    expect(compareSbomQuality(beyondBoundary, baseline).status).toBe(
      "regression",
    );
  });

  it("emits the same versioned BSI profile findings for the same stored inputs", () => {
    const quality = calculateSbomQuality({
      components: [],
      primaryComponent: null,
    });

    expect(evaluateBsiTr03183_2(quality)).toEqual(
      evaluateBsiTr03183_2(quality),
    );
    expect(evaluateBsiTr03183_2(quality)).toContainEqual(
      expect.objectContaining({
        code: "CRA-BSI-03183-2-PURL",
        severity: "error",
      }),
    );
  });
});
