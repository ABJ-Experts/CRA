import {
  MATCHING_ACCURACY_THRESHOLD,
  assertGoldenAccuracyGate,
  calculateGoldenAccuracy,
} from "./golden-accuracy-gate";
import {
  GOLDEN_DATASET_SHA256,
  goldenDatasetDigest,
  goldenMetrics,
} from "./golden-dataset";

describe("M4-02 versioned matching golden dataset", () => {
  it("has a reviewed digest and zero deterministic false positives/negatives", () => {
    expect(goldenDatasetDigest()).toBe(GOLDEN_DATASET_SHA256);
    expect(goldenMetrics()).toMatchObject({
      falsePositives: 0,
      falseNegatives: 0,
    });
  });

  it("measures every case, including negative cases, and enforces the release threshold", () => {
    const run = calculateGoldenAccuracy();

    expect(run.totalCases).toBe(run.metrics.length);
    expect(run.metrics.every((metric) => metric.totalCases === 1)).toBe(true);
    expect(run.accuracyScore).toBe(1);
    expect(run.passed).toBe(true);
    expect(MATCHING_ACCURACY_THRESHOLD).toBe(0.98);
    expect(assertGoldenAccuracyGate(run)).toBe(run);
    expect(() =>
      assertGoldenAccuracyGate({ ...run, accuracyScore: 0.97, passed: false }),
    ).toThrow("below 0.98");
  });
});
