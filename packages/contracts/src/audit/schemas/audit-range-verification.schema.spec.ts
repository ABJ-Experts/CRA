import { describe, expect, it } from "vitest";
import {
  auditRangeCreateInputSchema,
  auditRangeOperationInputSchema,
  auditRangeCheckpointSchema,
  auditRangeJobSchema,
  auditRangeResultSchema,
} from "./audit-range-verification.schema.js";
const id = "11111111-1111-4111-8111-111111111111";
const date = "2026-10-07T00:00:00Z";
const hash = "a".repeat(64);
const checkpoint = {
  organizationId: id,
  activationAt: date,
  chainVersion: 1,
  sequence: "3",
  hash,
};
const result = {
  outcome: "consistent",
  algorithm: "sha256",
  chainVersion: 1,
  requestedRange: { from: "1", to: null },
  frozenRange: { from: "1", to: "3" },
  checkedRange: { from: "1", to: "3" },
  verifiedPrefix: { from: "1", to: "3" },
  checkedCount: "3",
  firstAffectedSequence: null,
  breaks: [],
  sampleSequences: [],
  inspectionComplete: true,
  checkedAt: date,
  datasetContext: "unknown",
  priorCheckpointStatus: "not_supplied",
  authenticityProven: false,
  completeLedgerVerified: false,
};
describe("audit range verification contracts", () => {
  it("defaults start and preserves decimal bigint input", () => {
    expect(
      auditRangeCreateInputSchema.parse({ requestId: id }).fromSequence,
    ).toBe("1");
    expect(
      auditRangeCreateInputSchema.parse({
        requestId: id,
        fromSequence: "9223372036854775807",
      }).fromSequence,
    ).toBe("9223372036854775807");
  });
  it.each(["0", "01", "-1", "1.1", "9223372036854775808"])(
    "rejects invalid positive sequence %s",
    (fromSequence) => {
      expect(
        auditRangeCreateInputSchema.safeParse({ requestId: id, fromSequence })
          .success,
      ).toBe(false);
    },
  );
  it("rejects reverse ranges and tenant supplied input", () => {
    expect(
      auditRangeCreateInputSchema.safeParse({
        requestId: id,
        fromSequence: "4",
        toSequence: "3",
      }).success,
    ).toBe(false);
    expect(
      auditRangeCreateInputSchema.safeParse({
        requestId: id,
        organizationId: id,
      }).success,
    ).toBe(false);
  });
  it("normalizes compact and existing checkpoint output", () => {
    expect(auditRangeCheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
    expect(
      auditRangeCheckpointSchema.parse({
        organizationId: id,
        status: "verified",
        reason: null,
        activationAt: date,
        legacyCount: "0",
        fromSequence: "1",
        upperSequence: "3",
        verifiedCount: "3",
        checkpointHash: hash,
        checkpointSequence: "3",
        fullChain: true,
        retention: null,
        archivalRequired: true,
      }),
    ).toEqual(checkpoint);
  });
  it("rejects missing, corrupt, zero, unsupported and malformed checkpoints", () => {
    for (const patch of [
      { chainVersion: 2 },
      { sequence: "0" },
      { hash: "secret" },
      { activationAt: null },
    ]) {
      expect(
        auditRangeCheckpointSchema.safeParse({ ...checkpoint, ...patch })
          .success,
      ).toBe(false);
    }
    expect(auditRangeCheckpointSchema.safeParse({}).success).toBe(false);
  });
  it("requires operation UUID and optimistic version", () => {
    expect(
      auditRangeOperationInputSchema.parse({
        requestId: id,
        expectedVersion: 0,
      }).expectedVersion,
    ).toBe(0);
    expect(
      auditRangeOperationInputSchema.safeParse({
        requestId: id,
        expectedVersion: -1,
      }).success,
    ).toBe(false);
  });
  it("matches PostgreSQL integer optimistic version limits", () => {
    expect(
      auditRangeOperationInputSchema.parse({
        requestId: id,
        expectedVersion: 2147483647,
      }).expectedVersion,
    ).toBe(2147483647);
    for (const expectedVersion of [2147483648, Number.MAX_SAFE_INTEGER]) {
      expect(
        auditRangeOperationInputSchema.safeParse({
          requestId: id,
          expectedVersion,
        }).success,
      ).toBe(false);
    }
    const job = {
      id,
      status: "queued",
      version: 2147483647,
      createdAt: date,
      updatedAt: date,
      result: null,
      failureCode: null,
    };
    expect(auditRangeJobSchema.safeParse(job).success).toBe(true);
    expect(
      auditRangeJobSchema.safeParse({ ...job, version: 2147483648 }).success,
    ).toBe(false);
  });
  it("permits consistent range but forbids authenticity and complete-ledger claims", () => {
    expect(auditRangeResultSchema.parse(result)).toEqual(result);
    expect(
      auditRangeResultSchema.safeParse({ ...result, authenticityProven: true })
        .success,
    ).toBe(false);
    expect(
      auditRangeResultSchema.safeParse({
        ...result,
        completeLedgerVerified: true,
      }).success,
    ).toBe(false);
    expect(
      auditRangeResultSchema.safeParse({ ...result, inspectionComplete: false })
        .success,
    ).toBe(false);
  });
  it("rejects hidden scope disclosure and accepts suppressed result", () => {
    expect(
      auditRangeResultSchema.safeParse({
        ...result,
        outcome: "scope_unavailable",
      }).success,
    ).toBe(false);
    expect(
      auditRangeResultSchema.safeParse({
        ...result,
        outcome: "scope_unavailable",
        frozenRange: null,
        checkedRange: null,
        verifiedPrefix: null,
        checkedCount: null,
        inspectionComplete: false,
      }).success,
    ).toBe(true);
  });
  it("does not disclose hidden checkpoint comparisons", () => {
    const hidden = {
      ...result,
      outcome: "scope_unavailable",
      frozenRange: null,
      checkedRange: null,
      verifiedPrefix: null,
      checkedCount: null,
      inspectionComplete: false,
    };
    for (const priorCheckpointStatus of ["matched", "mismatch", "ahead"]) {
      expect(
        auditRangeResultSchema.safeParse({ ...hidden, priorCheckpointStatus })
          .success,
      ).toBe(false);
    }
    expect(
      auditRangeResultSchema.safeParse({
        ...hidden,
        priorCheckpointStatus: "unavailable",
      }).success,
    ).toBe(true);
  });
  it("bounds precise missing intervals and samples", () => {
    const broken = {
      ...result,
      outcome: "integrity_break",
      firstAffectedSequence: "2",
      verifiedPrefix: { from: "1", to: "1" },
      breaks: [
        {
          category: "missing_sequence_interval",
          fromSequence: "2",
          toSequence: "2",
        },
      ],
      sampleSequences: ["2"],
    };
    expect(auditRangeResultSchema.safeParse(broken).success).toBe(true);
    expect(
      auditRangeResultSchema.safeParse({
        ...broken,
        breaks: Array(101).fill(broken.breaks[0]),
      }).success,
    ).toBe(false);
    expect(
      auditRangeResultSchema.safeParse({
        ...broken,
        sampleSequences: Array(101).fill("2"),
      }).success,
    ).toBe(false);
    expect(
      auditRangeResultSchema.safeParse({
        ...broken,
        firstAffectedSequence: null,
      }).success,
    ).toBe(false);
  });
  it("rejects optimistic green results with partial coverage or missing trust boundary", () => {
    for (const patch of [
      { priorCheckpointStatus: "mismatch" },
      { priorCheckpointStatus: "ahead" },
      { priorCheckpointStatus: "unavailable" },
      { checkedRange: { from: "1", to: "2" } },
      { verifiedPrefix: { from: "1", to: "2" } },
      { checkedCount: "2" },
      { checkedRange: { from: "1", to: "4" } },
    ]) {
      expect(
        auditRangeResultSchema.safeParse({ ...result, ...patch }).success,
      ).toBe(false);
    }
  });
  it("keeps workflow distinct from integrity", () => {
    const job = {
      id,
      status: "completed",
      version: 2,
      createdAt: date,
      updatedAt: date,
      result,
      failureCode: null,
    };
    expect(auditRangeJobSchema.safeParse(job).success).toBe(true);
    expect(
      auditRangeJobSchema.safeParse({ ...job, status: "processing" }).success,
    ).toBe(false);
    expect(
      auditRangeJobSchema.safeParse({ ...job, status: "cancelled" }).success,
    ).toBe(false);
    expect(
      auditRangeJobSchema.safeParse({ ...job, result: null }).success,
    ).toBe(false);
  });
});
