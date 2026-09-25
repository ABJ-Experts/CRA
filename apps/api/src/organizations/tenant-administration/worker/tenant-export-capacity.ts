import {
  simulateExportCapacity,
  type ExportCapacityProfile,
} from "./export-archive";

type Environment = Readonly<Record<string, string | undefined>>;

const positiveInteger = (environment: Environment, name: string): number => {
  const raw = environment[name];
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(
      `${name} must be a positive integer deployment profile value`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(
      `${name} must be a positive integer deployment profile value`,
    );
  }
  return value;
};

const percentage = (environment: Environment, name: string): number => {
  const raw = environment[name];
  if (!raw || !/^(?:0|[1-9]\d?|100)$/.test(raw)) {
    throw new Error(`${name} must be an integer percentage from 0 through 100`);
  }
  const value = Number(raw);
  if (value === 100) {
    throw new Error(`${name} must be below 100 so work can make progress`);
  }
  return value / 100;
};

/**
 * CI/deployment supplies a representative capacity profile. There is no
 * hidden tenant-size default: changing the supported profile requires an
 * explicit, reviewable input and a fresh NFR-020 calculation.
 */
export const exportCapacityProfileFromEnvironment = (
  environment: Environment,
): ExportCapacityProfile =>
  Object.freeze({
    sourceCount: positiveInteger(
      environment,
      "TENANT_EXPORT_CAPACITY_SOURCE_COUNT",
    ),
    averagePartBytes: positiveInteger(
      environment,
      "TENANT_EXPORT_CAPACITY_AVERAGE_PART_BYTES",
    ),
    uploadBytesPerSecond: positiveInteger(
      environment,
      "TENANT_EXPORT_CAPACITY_UPLOAD_BYTES_PER_SECOND",
    ),
    partOverheadMs: positiveInteger(
      environment,
      "TENANT_EXPORT_CAPACITY_PART_OVERHEAD_MS",
    ),
    retryRate: percentage(
      environment,
      "TENANT_EXPORT_CAPACITY_RETRY_RATE_PERCENT",
    ),
    maxAttempts: positiveInteger(
      environment,
      "TENANT_EXPORT_CAPACITY_MAX_ATTEMPTS",
    ),
    maximumArchiveBytes: positiveInteger(
      environment,
      "TENANT_EXPORT_MAX_ARCHIVE_BYTES",
    ),
  });

export const verifyExportCapacityTarget = (profile: ExportCapacityProfile) => {
  const result = simulateExportCapacity(profile);
  if (!result.meetsTarget) {
    throw new Error(
      "tenant export capacity profile exceeds the 24-hour target",
    );
  }
  return result;
};

if (require.main === module) {
  const result = verifyExportCapacityTarget(
    exportCapacityProfileFromEnvironment(process.env),
  );
  process.stdout.write(`${JSON.stringify({ ...result, targetHours: 24 })}\n`);
}
