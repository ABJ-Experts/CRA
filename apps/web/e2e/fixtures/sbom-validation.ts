type SbomFixture = Readonly<{
  fileName: (runId: string) => string;
  mediaType: string;
  bytes: () => Buffer;
}>;

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const validCycloneDx = Object.freeze({
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  metadata: Object.freeze({
    timestamp: "2026-08-21T00:00:00Z",
  }),
  components: Object.freeze([
    Object.freeze({
      type: "library",
      "bom-ref": "pkg:npm/e2e-valid@1.0.0",
      name: "e2e-valid",
      version: "1.0.0",
    }),
  ]),
});

const invalidCycloneDx = Object.freeze({
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  version: 1,
  components: Object.freeze([
    Object.freeze({
      type: "library",
      "bom-ref": "pkg:npm/e2e-invalid@1.0.0",
    }),
  ]),
});

export const sbomValidationFixtures = Object.freeze({
  valid: Object.freeze<SbomFixture>({
    fileName: (runId) => `e2e-valid-${runId}.cdx.json`,
    mediaType: "application/vnd.cyclonedx+json",
    bytes: () => jsonBytes(validCycloneDx),
  }),
  invalid: Object.freeze<SbomFixture>({
    fileName: (runId) => `e2e-invalid-${runId}.cdx.json`,
    mediaType: "application/vnd.cyclonedx+json",
    bytes: () => jsonBytes(invalidCycloneDx),
  }),
  corrected: Object.freeze<SbomFixture>({
    fileName: (runId) => `e2e-corrected-${runId}.cdx.json`,
    mediaType: "application/vnd.cyclonedx+json",
    bytes: () => jsonBytes(validCycloneDx),
  }),
});
