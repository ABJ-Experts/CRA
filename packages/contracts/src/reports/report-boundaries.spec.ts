import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as reports from "./index.js";
import { exportSources } from "../exports/index.js";
const id = "e8a43815-631a-4363-9744-4dd067f49ab1";
const instant = "2026-10-12T09:00:00Z";
const digest = "a".repeat(64);
const config = {
  title: "Products",
  report: {
    kind: "list",
    source: "products.registry",
    format: "csv",
    context: {},
    filters: {},
  },
  schedule: { frequency: "daily", timezone: "UTC", localTime: "09:00" },
  dateWindow: { kind: "fixed" },
  recipientUserIds: [id],
  emailEnabled: false,
};
const artifact = {
  id,
  name: "products.csv",
  mediaType: "text/csv",
  byteLength: 10,
  sha256: digest,
  rowCount: 1,
};
const run = {
  id,
  definitionId: id,
  definitionVersion: 1,
  kind: "scheduled",
  state: "succeeded",
  scheduledFor: instant,
  occurrenceKey: "UTC:2026-10-12T09:00",
  createdAt: instant,
  finishedAt: instant,
  safeErrorCode: null,
};
const recipient = {
  id,
  userId: id,
  generationState: "ready",
  emailState: "off",
  safeErrorCode: null,
  expiresAt: instant,
  artifacts: [artifact],
};
const exportManifest = {
  version: "m14_03_v1",
  jobId: id,
  source: "products.registry",
  requestedAt: instant,
  snapshotAsOf: instant,
  scope: "all_filtered",
  requestDigest: digest,
  rowCount: 1,
  columns: [],
  artifacts: [artifact],
  sourceVersionsDigest: digest,
  documentationReadinessOnly: false,
};
const manifest = {
  schemaVersion: "m14_04_v1",
  definitionId: id,
  definitionVersion: 1,
  configDigest: digest,
  runId: id,
  recipientId: id,
  occurrenceKey: run.occurrenceKey,
  scheduledFor: instant,
  asOf: instant,
  sourceContextDigest: digest,
  ownerPermissionVersion: "1",
  recipientPermissionVersion: "1",
  scopeDigest: digest,
  exportManifest,
};
type FixtureSchema = {
  type?: string;
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  required?: string[];
  properties?: Record<string, FixtureSchema>;
  minimum?: number;
};
function fixture(schema: FixtureSchema): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type === "object")
    return Object.fromEntries(
      (schema.required ?? [])
        .filter((key) => !reports.reportTransientFields.includes(key))
        .map((key) => [key, fixture(schema.properties![key]!)]),
    );
  if (schema.format === "uuid") return id;
  if (schema.format === "date-time") return instant;
  if (schema.type === "number" || schema.type === "integer")
    return schema.minimum ?? 1;
  if (schema.type === "boolean") return false;
  return "example";
}
describe("complete source contract integration", () => {
  it.each(
    Object.entries(exportSources).filter(
      ([, spec]) => spec.subjectKind === "member",
    ),
  )("parses %s and rejects unsafe source fields", (source, spec) => {
    const context =
      source === "audit.events"
        ? {}
        : fixture(
            z.toJSONSchema(spec.contextSchema, {
              io: "output",
              unrepresentable: "any",
            }) as FixtureSchema,
          );
    const descriptor = z.toJSONSchema(spec.querySchema, {
      io: "output",
      unrepresentable: "any",
    }) as FixtureSchema;
    const nativeDefaults =
      descriptor.type === "object"
        ? (fixture(descriptor) as Record<string, unknown>)
        : {};
    const defaults = Object.fromEntries(
      Object.entries(nativeDefaults).filter(([key]) => key !== "requestId"),
    );
    const filters =
      source === "audit.events"
        ? { from: "2026-09-01T00:00:00Z", to: "2026-09-30T00:00:00Z" }
        : source === "dashboard.trends"
          ? { from: "2026-09-01", to: "2026-09-30" }
          : defaults;
    const candidate = {
      ...config,
      report: { ...config.report, source, context, filters },
    };
    const parsed = reports.reportConfigurationSchema.parse(candidate);
    expect(reports.reportConfigurationSchema.parse(parsed)).toEqual(parsed);
    expect(
      reports.reportConfigurationSchema.safeParse({
        ...candidate,
        report: {
          ...candidate.report,
          filters: { ...filters, arbitrarySql: "select 1" },
        },
      }).success,
    ).toBe(false);
    expect(
      reports.reportConfigurationSchema.safeParse({
        ...candidate,
        report: {
          ...candidate.report,
          context: { ...(context as object), sessionId: id },
        },
      }).success,
    ).toBe(false);
  });
});
describe("scheduled wire boundaries", () => {
  it("requires UUID keyset cursors for all report lists", () => {
    expect(reports.reportListQuerySchema.parse({ cursor: id }).cursor).toBe(id);
    for (const cursor of ["malformed", "opaque", "", "x".repeat(6000)]) {
      expect(reports.reportListQuerySchema.safeParse({ cursor }).success).toBe(
        false,
      );
      expect(reports.reportRunsQuerySchema.safeParse({ cursor }).success).toBe(
        false,
      );
    }
    for (const schema of [
      reports.reportDefinitionListResponseSchema,
      reports.reportRunListResponseSchema,
      reports.reportRecipientsResponseSchema,
      reports.reportAdministrationListResponseSchema,
    ]) {
      expect(schema.safeParse({ items: [], nextCursor: id }).success).toBe(
        true,
      );
      expect(
        schema.safeParse({ items: [], nextCursor: "malformed" }).success,
      ).toBe(false);
    }
  });
  it("validates bounded recipient preview eligibility without exposing source data", () => {
    expect(
      reports.reportRunDetailResponseSchema.parse({
        run,
        recipients: [recipient],
      }).recipientEligibility,
    ).toEqual([]);
    const eligibility = { userId: id, state: "eligible", safeErrorCode: null };
    const ineligible = {
      userId: id,
      state: "ineligible",
      safeErrorCode: "source_access_denied",
    };
    expect(
      reports.reportRunDetailResponseSchema.parse({
        run,
        recipients: [recipient],
        recipientEligibility: [eligibility, ineligible],
      }).recipientEligibility,
    ).toEqual([eligibility, ineligible]);
    for (const changed of [
      { ...eligibility, state: "ineligible" },
      { ...eligibility, safeErrorCode: "source_access_denied" },
      { ...ineligible, safeErrorCode: "internal_sql_error" },
      { ...eligibility, rowCount: 10 },
    ])
      expect(
        reports.reportRunDetailResponseSchema.safeParse({
          run,
          recipients: [],
          recipientEligibility: [changed],
        }).success,
      ).toBe(false);
    expect(
      reports.reportRunDetailResponseSchema.safeParse({
        run,
        recipients: [],
        recipientEligibility: Array.from({ length: 21 }, () => eligibility),
      }).success,
    ).toBe(false);
  });
  it("bounds recipient roster pages and carries continuation cursors", () => {
    const member = { id, displayName: "Owner" };
    expect(
      reports.reportRecipientsResponseSchema.safeParse({
        items: Array.from({ length: 50 }, () => member),
        nextCursor: id,
      }).success,
    ).toBe(true);
    expect(
      reports.reportRecipientsResponseSchema.safeParse({
        items: Array.from({ length: 51 }, () => member),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      reports.reportRecipientsResponseSchema.safeParse({ items: [member] })
        .success,
    ).toBe(false);
  });
  it("limits administration to schedule identifiers and lifecycle metadata", () => {
    const summary = { id, ownerUserId: id, state: "paused", version: 2 };
    expect(
      reports.reportAdministrationListResponseSchema.parse({
        items: [summary],
        nextCursor: null,
      }).items,
    ).toEqual([summary]);
    expect(
      reports.reportAdministrationMutationResponseSchema.parse({
        data: summary,
      }).data,
    ).toEqual(summary);
    for (const extra of [{ title: "private" }, { config }, { rowCount: 10 }])
      expect(
        reports.reportAdministrationMutationResponseSchema.safeParse({
          data: { ...summary, ...extra },
        }).success,
      ).toBe(false);
  });
  it("parses every public request, path and query", () => {
    expect(
      reports.createReportDefinitionSchema.parse({ config, idempotencyKey: id })
        .config.title,
    ).toBe("Products");
    expect(
      reports.updateReportDefinitionSchema.parse({
        config,
        idempotencyKey: id,
        expectedVersion: 1,
      }).expectedVersion,
    ).toBe(1);
    expect(
      reports.reportMutationSchema.parse({
        expectedVersion: 1,
        idempotencyKey: id,
        previewRunId: id,
      }).previewRunId,
    ).toBe(id);
    for (const [schema, input] of [
      [reports.reportDefinitionParamsSchema, { definitionId: id }],
      [reports.reportRunParamsSchema, { runId: id }],
      [reports.reportRecipientParamsSchema, { runId: id, recipientId: id }],
      [
        reports.reportDownloadParamsSchema,
        { runId: id, recipientId: id, grantId: id },
      ],
      [reports.reportGrantInputSchema, { artifactId: id }],
      [
        reports.reportEmailPreferenceInputSchema,
        { mode: "off", expectedVersion: 1, idempotencyKey: id },
      ],
    ] as const) {
      expect(schema.safeParse(input).success).toBe(true);
      expect(schema.safeParse({ ...input, token: "unsafe" }).success).toBe(
        false,
      );
    }
    expect(
      reports.reportRunsQuerySchema.parse({ definitionId: id, limit: "50" })
        .limit,
    ).toBe(50);
    expect(
      reports.reportListQuerySchema.safeParse({ cursor: "" }).success,
    ).toBe(false);
  });
  it("parses every response and refuses leaked internal state", () => {
    const definition = {
      id,
      ownerUserId: id,
      definitionVersion: 1,
      version: 1,
      state: "draft",
      config,
      configDigest: digest,
      schemaVersion: "m14_04_v1",
      nextDueAt: null,
      previewRunId: null,
      pauseReason: null,
      createdAt: instant,
      updatedAt: instant,
    };
    for (const [schema, response] of [
      [reports.reportDefinitionResponseSchema, { data: definition }],
      [
        reports.reportDefinitionListResponseSchema,
        { items: [definition], nextCursor: null },
      ],
      [reports.reportRunDetailResponseSchema, { run, recipients: [recipient] }],
      [reports.reportRunListResponseSchema, { items: [run], nextCursor: null }],
      [
        reports.reportRecipientsResponseSchema,
        { items: [{ id, displayName: "Owner" }], nextCursor: null },
      ],
      [reports.reportEmailPreferenceSchema, { mode: "off", version: 1 }],
      [reports.reportManifestResponseSchema, { data: manifest }],
      [
        reports.reportDownloadGrantResponseSchema,
        {
          data: {
            grantId: id,
            url: `/api/v1/reports/runs/${id}/recipients/${id}/download/${id}`,
            expiresAt: instant,
            artifact,
          },
        },
      ],
    ] as const) {
      expect(schema.safeParse(response).success).toBe(true);
      expect(
        schema.safeParse({ ...response, storagePath: "private" }).success,
      ).toBe(false);
    }
  });
  it("pins manifest capture provenance and protected grant paths", () => {
    expect(
      reports.reportManifestSchema.safeParse({
        ...manifest,
        asOf: "2026-10-13T09:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      reports.reportManifestSchema.safeParse({
        ...manifest,
        exportManifest: { ...exportManifest, scope: "selected" },
      }).success,
    ).toBe(false);
    for (const url of [
      "https://example.com/private",
      "/api/v1/reports/../private",
      "/api/v1/reports/with space",
      "/api/v1/reports/\\private",
    ])
      expect(
        reports.reportDownloadGrantResponseSchema.safeParse({
          data: { grantId: id, url, expiresAt: instant, artifact },
        }).success,
      ).toBe(false);
  });
  it("never exposes artifacts for a revoked or skipped recipient", () => {
    expect(
      reports.reportRunRecipientSchema.safeParse({
        ...recipient,
        generationState: "revoked",
      }).success,
    ).toBe(false);
    expect(
      reports.reportRunRecipientSchema.safeParse({
        ...recipient,
        generationState: "skipped",
      }).success,
    ).toBe(false);
    expect(
      reports.reportRunRecipientSchema.safeParse({
        ...recipient,
        artifacts: [],
        expiresAt: null,
      }).success,
    ).toBe(true);
    expect(
      reports.reportRunRecipientSchema.safeParse({
        ...recipient,
        expiresAt: null,
      }).success,
    ).toBe(false);
  });
});
