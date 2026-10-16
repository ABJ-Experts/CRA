import { describe, expect, it } from "vitest";
import * as schemas from "./index.js";
import { DIAGNOSTIC_DISCLOSURE_VERSION, DIAGNOSTIC_LIMITS } from "../index.js";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-01T12:00:00Z";
const sha256 = "a".repeat(64);
const selection = {
  categories: ["logs", "configuration", "metrics"],
  from: "2026-10-01T00:00:00Z",
  to: at,
};
const log = {
  at,
  source: "audit",
  code: "operation_completed",
  outcome: "completed",
};
const configuration = {
  observedAt: at,
  accessTokenSeconds: 3600,
  refreshTokenSeconds: 604800,
  smtpTlsMode: "mailpit",
  maxBundleBytes: 10485760,
  maxLogRows: 5000,
};
const metric = {
  source: "database",
  status: "unknown",
  sourceAt: null,
  observedAt: null,
  pending: null,
  running: null,
  failedTerminal: null,
  storageBytes: null,
};
const omission = { category: "logs", code: "source_withheld" };
const manifest = {
  version: "m15_04_v1",
  jobId: id,
  generatedAt: at,
  selection,
  entries: [{ name: "logs.json", sha256, byteSize: 20 }],
  omissions: [omission],
};
const job = {
  id,
  organizationId: id,
  state: "queued",
  stage: "queued",
  version: 1,
  consentedAt: at,
  createdAt: at,
  completedAt: null,
  expiresAt: null,
  selection,
  progress: { completed: 0, total: 1 },
  omissions: [],
  artifact: null,
  failureCode: null,
  cleanup: { state: "none", blockers: [] },
};

// These tests protect the consent, redaction, and bounded-response boundary.
describe("support diagnostic contracts", () => {
  it("exposes the agreed disclosure and resource limits", () => {
    expect(DIAGNOSTIC_DISCLOSURE_VERSION).toBe("m15_04_v1");
    expect(DIAGNOSTIC_LIMITS).toMatchObject({
      maxBundleBytes: 10485760,
      maxLogRows: 5000,
      maxRangeDays: 7,
      previewTtlSeconds: 600,
      availabilitySeconds: 86400,
      generationTimeoutSeconds: 60,
      leaseSeconds: 60,
      heartbeatSeconds: 10,
      maxAttempts: 3,
      maxWorkingBytes: 67108864,
      maxActivePerOrganization: 1,
    });
  });
  it("accepts the selection itself as preview input", () => {
    expect(schemas.diagnosticPreviewInputSchema.parse(selection)).toEqual(
      selection,
    );
    expect(
      schemas.diagnosticPreviewInputSchema.safeParse({ selection }).success,
    ).toBe(false);
  });
  it.each([
    { ...selection, categories: [] },
    { ...selection, categories: ["logs", "logs"] },
    { ...selection, categories: ["secrets"] },
    { ...selection, from: at, to: selection.from },
    { ...selection, from: "2026-09-01T00:00:00Z" },
    { ...selection, from: "2026-10-01T00:00:00+01:00" },
    { ...selection, actorId: id },
  ])("rejects invalid or expanded selections %#", (value) => {
    expect(schemas.diagnosticSelectionSchema.safeParse(value).success).toBe(
      false,
    );
  });
  it("accepts exactly seven days but rejects equal endpoints", () => {
    expect(
      schemas.diagnosticSelectionSchema.parse({
        ...selection,
        from: "2026-09-24T12:00:00Z",
      }),
    ).toBeDefined();
    expect(
      schemas.diagnosticSelectionSchema.safeParse({ ...selection, from: at })
        .success,
    ).toBe(false);
  });
  it("requires explicit consent, signed preview and UUID idempotency", () => {
    const input = {
      previewToken: "signed.token",
      consent: true,
      idempotencyKey: id,
    };
    expect(schemas.diagnosticCreateSchema.parse(input)).toEqual(input);
    expect(
      schemas.diagnosticCreateSchema.safeParse({ ...input, consent: false })
        .success,
    ).toBe(false);
    expect(
      schemas.diagnosticCreateSchema.safeParse({ ...input, selection }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticCreateSchema.safeParse({ ...input, previewToken: "" })
        .success,
    ).toBe(false);
  });
  it("requires optimistic concurrency and a reviewed cleanup fingerprint", () => {
    const input = { expectedVersion: 1, idempotencyKey: id };
    expect(schemas.diagnosticMutationSchema.parse(input)).toEqual(input);
    expect(
      schemas.diagnosticMutationSchema.safeParse({
        ...input,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticCleanupInputSchema.parse({
        ...input,
        reviewFingerprint: sha256,
      }),
    ).toBeDefined();
    expect(schemas.diagnosticCleanupInputSchema.safeParse(input).success).toBe(
      false,
    );
  });
  it("parses bounded query and UUID path parameters", () => {
    expect(schemas.diagnosticJobParamsSchema.parse({ jobId: id })).toEqual({
      jobId: id,
    });
    expect(
      schemas.diagnosticDownloadParamsSchema.parse({ jobId: id, grantId: id }),
    ).toBeDefined();
    expect(
      schemas.diagnosticJobParamsSchema.safeParse({ jobId: "../file" }).success,
    ).toBe(false);
    expect(schemas.diagnosticListQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(
      schemas.diagnosticListQuerySchema.parse({ limit: "50", cursor: id }),
    ).toEqual({ limit: 50, cursor: id });
    expect(schemas.diagnosticContentQuerySchema.parse({})).toEqual({
      section: "logs",
      offset: 0,
      limit: 100,
    });
    expect(
      schemas.diagnosticContentQuerySchema.parse({ offset: "1", limit: "10" }),
    ).toMatchObject({ offset: 1, limit: 10 });
    expect(
      schemas.diagnosticContentQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticContentQuerySchema.safeParse({ offset: -1 }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticContentQuerySchema.safeParse({ limit: true }).success,
    ).toBe(false);
  });
  it("permits only fixed structured log fields and values", () => {
    expect(schemas.diagnosticLogSchema.parse(log)).toEqual(log);
    for (const value of [
      { ...log, message: "credential" },
      { ...log, source: "raw" },
      { ...log, code: "raw action" },
      "raw log",
    ]) {
      expect(schemas.diagnosticLogSchema.safeParse(value).success).toBe(false);
    }
  });
  it("keeps configuration and metrics closed and bounded", () => {
    expect(schemas.diagnosticConfigurationSchema.parse(configuration)).toEqual(
      configuration,
    );
    expect(
      schemas.diagnosticConfigurationSchema.safeParse({
        ...configuration,
        smtpPassword: "secret",
      }).success,
    ).toBe(false);
    expect(schemas.diagnosticMetricSchema.parse(metric)).toEqual(metric);
    expect(
      schemas.diagnosticMetricSchema.safeParse({
        ...metric,
        source: "private-name",
      }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticMetricSchema.safeParse({ ...metric, pending: -1 })
        .success,
    ).toBe(false);
    expect(
      schemas.diagnosticMetricSchema.safeParse({ ...metric, message: "raw" })
        .success,
    ).toBe(false);
    expect(schemas.diagnosticOmissionSchema.parse(omission)).toEqual(omission);
  });
  it("validates payload sections without arbitrary text or identity fields", () => {
    expect(
      schemas.diagnosticPayloadSchema.parse({
        logs: [log],
        configuration,
        metrics: [metric],
        omissions: [],
      }),
    ).toBeDefined();
    expect(
      schemas.diagnosticPayloadSchema.parse({ omissions: [omission] }),
    ).toEqual({ omissions: [omission] });
    expect(
      schemas.diagnosticPayloadSchema.safeParse({
        logs: Array.from({ length: 5001 }, () => log),
        omissions: [],
      }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticPayloadSchema.safeParse({
        organizationId: id,
        omissions: [],
      }).success,
    ).toBe(false);
  });
  it("limits archive manifests to unique deterministic safe names", () => {
    expect(schemas.diagnosticManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      schemas.diagnosticManifestSchema.safeParse({
        ...manifest,
        entries: [{ name: "../secret", sha256, byteSize: 1 }],
      }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticManifestSchema.safeParse({
        ...manifest,
        entries: [...manifest.entries, ...manifest.entries],
      }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticManifestSchema.safeParse({
        ...manifest,
        organizationId: id,
      }).success,
    ).toBe(false);
  });
  it("validates jobs and paginated lists", () => {
    expect(schemas.diagnosticJobSchema.parse(job)).toEqual(job);
    expect(
      schemas.diagnosticJobSchema.parse({
        ...job,
        state: "ready",
        stage: "ready",
        artifact: {
          sha256,
          byteSize: 20,
          fileName: `support-diagnostics-${id}.zip`,
        },
      }),
    ).toBeDefined();
    expect(
      schemas.diagnosticJobSchema.safeParse({
        ...job,
        progress: { completed: 2, total: 1 },
      }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticJobSchema.safeParse({
        ...job,
        artifact: { sha256, byteSize: 10485761, fileName: "../file.zip" },
      }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticListSchema.parse({
        organizationId: id,
        items: [job],
        nextCursor: null,
      }),
    ).toBeDefined();
  });
  it("binds content sections to structured data", () => {
    const base = { organizationId: id, jobId: id, manifest, nextOffset: null };
    for (const [section, data] of [
      ["logs", [log]],
      ["configuration", configuration],
      ["metrics", [metric]],
      ["omissions", [omission]],
    ]) {
      expect(
        schemas.diagnosticContentSchema.parse({ ...base, section, data }),
      ).toBeDefined();
    }
    expect(
      schemas.diagnosticContentSchema.parse({
        ...base,
        section: "configuration",
        data: null,
      }).data,
    ).toBeNull();
    expect(
      schemas.diagnosticContentSchema.safeParse({
        ...base,
        section: "logs",
        data: [metric],
      }).success,
    ).toBe(false);
  });
  it("validates relative same API download paths and cleanup reviews", () => {
    const grant = {
      organizationId: id,
      jobId: id,
      grantId: id,
      downloadPath: `/api/v1/system/diagnostics/bundles/${id}/download/${id}`,
      expiresAt: at,
    };
    expect(schemas.diagnosticGrantSchema.parse(grant)).toEqual(grant);
    expect(
      schemas.diagnosticGrantSchema.safeParse({
        ...grant,
        downloadPath: "https://evil.test/file",
      }).success,
    ).toBe(false);
    expect(
      schemas.diagnosticCleanupReviewSchema.parse({
        organizationId: id,
        jobId: id,
        eligible: true,
        blockers: [],
        reviewFingerprint: sha256,
      }),
    ).toBeDefined();
  });
  it("validates conservative unmeasured previews with a closed disclosure", () => {
    const preview = {
      organizationId: id,
      disclosureVersion: "m15_04_v1",
      selection,
      estimate: { maxBytes: 10485760, maxLogRows: 5000, measured: false },
      fields: {
        logs: ["at", "source", "code", "outcome"],
        configuration: ["smtpTlsMode"],
        metrics: ["source", "status"],
      },
      examples: {
        logs: "Redacted operation outcome",
        configuration: "TLS mode",
        metrics: "Queue count",
      },
      previewToken: "signed.token",
      expiresAt: at,
    };
    expect(schemas.diagnosticPreviewSchema.parse(preview)).toEqual(preview);
    expect(
      schemas.diagnosticPreviewSchema.safeParse({
        ...preview,
        estimate: { ...preview.estimate, measured: true },
      }).success,
    ).toBe(false);
  });
});
