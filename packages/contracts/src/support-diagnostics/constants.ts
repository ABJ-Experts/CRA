export const DIAGNOSTIC_DISCLOSURE_VERSION = "m15_04_v1" as const;

export const DIAGNOSTIC_LIMITS = {
  maxBundleBytes: 10_485_760,
  maxLogRows: 5_000,
  maxRangeDays: 7,
  previewTtlSeconds: 600,
  availabilitySeconds: 86_400,
  generationTimeoutSeconds: 60,
  leaseSeconds: 60,
  heartbeatSeconds: 10,
  maxAttempts: 3,
  maxWorkingBytes: 67_108_864,
  maxActivePerOrganization: 1,
} as const;
