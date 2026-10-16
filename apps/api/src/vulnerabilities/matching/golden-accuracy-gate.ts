import {
  COMPARATOR_REGISTRY_VERSION,
  CONFIDENCE_TABLE_VERSION,
} from "./matching-policy";
import {
  GOLDEN_DATASET_VERSION,
  goldenDatasetDigest,
  goldenMetrics,
} from "./golden-dataset";

/** The release threshold agreed for deterministic PURL/OSV matching. */
export const MATCHING_ACCURACY_THRESHOLD = 0.98;

export type GoldenAccuracyRun = Readonly<{
  datasetVersion: string;
  datasetDigest: string;
  comparatorRegistryVersion: string;
  confidenceTableVersion: string;
  totalCases: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  accuracyScore: number;
  passed: boolean;
  metrics: readonly Readonly<{
    releaseKey: string;
    ecosystem: string;
    matchMethod: "purl_osv" | "cpe_nvd";
    sourceFeedKey: "osv" | "nvd";
    totalCases: number;
    falsePositiveCount: number;
    falseNegativeCount: number;
  }>[];
}>;

export function calculateGoldenAccuracy(): GoldenAccuracyRun {
  const result = goldenMetrics();
  const accuracyScore = Math.max(
    0,
    1 - (result.falsePositives + result.falseNegatives) / result.totalCases,
  );
  return Object.freeze({
    datasetVersion: GOLDEN_DATASET_VERSION,
    datasetDigest: goldenDatasetDigest(),
    comparatorRegistryVersion: COMPARATOR_REGISTRY_VERSION,
    confidenceTableVersion: CONFIDENCE_TABLE_VERSION,
    totalCases: result.totalCases,
    falsePositiveCount: result.falsePositives,
    falseNegativeCount: result.falseNegatives,
    accuracyScore,
    passed: accuracyScore >= MATCHING_ACCURACY_THRESHOLD,
    metrics: Object.freeze(
      result.metrics.map((metric) =>
        Object.freeze({
          releaseKey: metric.release,
          ecosystem: metric.ecosystem,
          matchMethod: metric.method,
          sourceFeedKey: metric.feed,
          totalCases: metric.totalCases,
          falsePositiveCount: metric.falsePositives,
          falseNegativeCount: metric.falseNegatives,
        }),
      ),
    ),
  });
}

/** Fails release verification before a below-threshold run can be recorded. */
export function assertGoldenAccuracyGate(
  run = calculateGoldenAccuracy(),
): GoldenAccuracyRun {
  if (!run.passed) {
    throw new Error(
      `Vulnerability matching golden accuracy ${run.accuracyScore.toFixed(4)} is below ${MATCHING_ACCURACY_THRESHOLD.toFixed(2)}`,
    );
  }
  return run;
}
