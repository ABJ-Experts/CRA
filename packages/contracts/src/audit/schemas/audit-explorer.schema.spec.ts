import { describe, expect, it } from "vitest";
import {
  auditSearchInputSchema,
  auditSearchFiltersSchema,
  auditPageQuerySchema,
  auditEventViewSchema,
  auditVerificationInputSchema,
  auditExportInputSchema,
  auditDownloadGrantSchema,
  auditExportManifestSchema,
  auditEventProofSchema,
  auditDetailSchema,
} from "./audit-explorer.schema.js";
const requestId = "00000000-0000-4000-8000-000000000001";
const filters = { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" };
const row = {
  id: requestId,
  sequence: "9007199254740993",
  legacy: false,
  createdAt: filters.from,
  actor: { id: requestId, type: "user", label: null },
  action: "product.updated",
  resourceType: "product",
  resourceId: requestId,
  correlationId: null,
  outcome: "completed",
  verificationStatus: "not_verified",
};
describe("audit explorer contracts", () => {
  it("bounds dates, accepts offset instants, and rejects inverted ranges", () => {
    expect(auditSearchFiltersSchema.parse(filters)).toEqual(filters);
    expect(
      auditSearchFiltersSchema.safeParse({
        ...filters,
        from: "2026-01-01T05:30:00+05:30",
      }).success,
    ).toBe(true);
    for (const invalid of [
      { ...filters, to: filters.from },
      { ...filters, to: "2027-02-01T00:00:00Z" },
      { ...filters, from: "2026-01-01" },
    ])
      expect(auditSearchFiltersSchema.safeParse(invalid).success).toBe(false);
  });
  it("rejects forged tenant fields and malformed filters", () => {
    expect(auditSearchInputSchema.parse({ requestId, filters })).toEqual({
      requestId,
      filters,
    });
    for (const invalid of [
      { requestId, filters, organizationId: requestId },
      { requestId: "bad", filters },
      { requestId, filters: { ...filters, actorId: "" } },
      { requestId, filters: { ...filters, correlationId: "bad" } },
    ])
      expect(auditSearchInputSchema.safeParse(invalid).success).toBe(false);
  });
  it("parses query limits and enforces bounded opaque cursors", () => {
    expect(auditPageQuerySchema.parse({ requestId }).limit).toBe(50);
    expect(auditPageQuerySchema.parse({ requestId, limit: "200" }).limit).toBe(
      200,
    );
    for (const limit of [0, 201, 1.5, "NaN"])
      expect(auditPageQuerySchema.safeParse({ requestId, limit }).success).toBe(
        false,
      );
    expect(
      auditPageQuerySchema.safeParse({ requestId, cursor: "x".repeat(12001) })
        .success,
    ).toBe(false);
  });
  it("preserves bigint sequences and makes legacy status honest", () => {
    expect(auditEventViewSchema.parse(row).sequence).toBe(row.sequence);
    expect(
      auditEventViewSchema.safeParse({ ...row, sequence: 1 }).success,
    ).toBe(false);
    expect(
      auditEventViewSchema.safeParse({ ...row, legacy: true }).success,
    ).toBe(false);
    expect(
      auditEventViewSchema.parse({
        ...row,
        sequence: null,
        legacy: true,
        verificationStatus: "legacy_unchained",
      }).legacy,
    ).toBe(true);
    expect(
      auditEventViewSchema.safeParse({
        ...row,
        sequence: null,
        legacy: true,
        verificationStatus: "event_hashes_checked",
      }).success,
    ).toBe(false);
  });
  it("requires bounded unique verification ids and idempotency", () => {
    expect(
      auditVerificationInputSchema.parse({ requestId, eventIds: [requestId] })
        .eventIds,
    ).toEqual([requestId]);
    for (const eventIds of [
      [],
      [requestId, requestId],
      Array(201).fill(requestId),
    ])
      expect(
        auditVerificationInputSchema.safeParse({ requestId, eventIds }).success,
      ).toBe(false);
    expect(
      auditExportInputSchema.parse({
        requestId,
        snapshotToken: "opaque",
        format: "csv",
      }).format,
    ).toBe("csv");
    expect(
      auditExportInputSchema.safeParse({
        requestId,
        snapshotToken: "opaque",
        format: "sql",
      }).success,
    ).toBe(false);
  });
  it("forbids external and query-bearing delivery URLs", () => {
    const grant = {
      url: `/api/v1/audit/exports/${requestId}/download`,
      expiresAt: filters.to,
      packageHash: "a".repeat(64),
    };
    expect(auditDownloadGrantSchema.parse(grant)).toEqual(grant);
    for (const url of [
      "https://example.com/file",
      "//example.com/file",
      `${grant.url}?token=secret`,
    ])
      expect(
        auditDownloadGrantSchema.safeParse({ ...grant, url }).success,
      ).toBe(false);
  });
  it("requires canonical byte proofs and prevents manifest authenticity claims", () => {
    const proof = {
      eventId: requestId,
      sequence: "1",
      previousHash: "0".repeat(64),
      contentHash: "a".repeat(64),
      canonicalContent: '{"value":1.000}',
    };
    expect(auditEventProofSchema.parse(proof).canonicalContent).toBe(
      proof.canonicalContent,
    );
    expect(
      auditEventProofSchema.safeParse({ ...proof, canonicalContent: {} })
        .success,
    ).toBe(false);
    expect(
      auditExportManifestSchema.safeParse({ authenticity: true }).success,
    ).toBe(false);
  });
  it("preserves typed redacted detail JSON", () => {
    const before = {
      accepted: false,
      count: 3,
      absent: null,
      nested: { state: "[REDACTED]" },
    };
    expect(
      auditDetailSchema.parse({ event: row, before, after: null, reason: null })
        .before,
    ).toEqual(before);
    expect(
      auditDetailSchema.safeParse({
        event: row,
        before: { invalid: undefined },
        after: null,
        reason: null,
      }).success,
    ).toBe(false);
  });
  it("binds manifest counts, ranges, and filenames to the selected format", () => {
    const file = (name: string) => ({
      name,
      sha256: "a".repeat(64),
      bytes: 20,
    });
    const manifest = {
      schema: "cra.audit-export.v1",
      hashAlgorithm: "sha256",
      organizationId: requestId,
      scopeDigest: "a".repeat(64),
      filters,
      format: "json",
      generatedAt: filters.to,
      timezone: "UTC",
      ordering: "sequence_desc_then_legacy_created_at_id_desc",
      sequenceRange: { from: "1", to: "3" },
      rowCount: 3,
      legacyCount: 1,
      proofCount: 2,
      files: [file("events.json"), file("proofs.ndjson"), file("verify.mjs")],
      completenessProven: false,
      authenticityProven: false,
    };
    expect(auditExportManifestSchema.parse(manifest).rowCount).toBe(3);
    for (const invalid of [
      { ...manifest, proofCount: 3 },
      { ...manifest, legacyCount: 4 },
      { ...manifest, sequenceRange: { from: "4", to: "3" } },
      {
        ...manifest,
        files: [file("events.csv"), file("proofs.ndjson"), file("verify.mjs")],
      },
      {
        ...manifest,
        files: [file("events.json"), file("events.json"), file("verify.mjs")],
      },
      { ...manifest, authenticityProven: true },
    ])
      expect(auditExportManifestSchema.safeParse(invalid).success).toBe(false);
    expect(
      auditExportManifestSchema.parse({
        ...manifest,
        rowCount: 0,
        legacyCount: 0,
        proofCount: 0,
        sequenceRange: { from: null, to: null },
      }).rowCount,
    ).toBe(0);
  });
});
