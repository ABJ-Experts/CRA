import { describe, expect, it } from "vitest";
import * as schemas from "./system-health.schema.js";

const time = "2026-10-14T10:00:00.000Z";
const queue = {
  id: "sboms",
  label: "SBOM processing",
  availability: "ready",
  pending: 0,
  running: 0,
  retrying: 0,
  waitingForReview: 0,
  uncertainDelivery: 0,
  failedTerminal: 0,
  oldestPendingAt: null,
  countRelation: "exact",
  observedAt: time,
  sourceAt: time,
  status: "unknown",
  reasons: [],
  interpretation: "queue_observation",
};

describe("health disclosure boundary", () => {
  it("accepts SBOM queue observations without asserting worker liveness", () => {
    expect(schemas.systemHealthQueueSchema.safeParse(queue).success).toBe(true);
  });
  it("keeps withheld metrics null instead of zero", () => {
    expect(
      schemas.systemHealthQueueSchema.safeParse({
        ...queue,
        availability: "withheld",
        pending: null,
        running: null,
        retrying: null,
        waitingForReview: null,
        uncertainDelivery: null,
        failedTerminal: null,
        countRelation: null,
        sourceAt: null,
        observedAt: null,
        reasons: ["source_permission_withheld"],
      }).success,
    ).toBe(true);
  });
  it("rejects arbitrary provider errors as reason codes", () => {
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        id: "database",
        label: "Database",
        status: "unknown",
        source: "supabase",
        sourceAt: null,
        observedAt: time,
        summary: "Unavailable",
        reasons: ["password_is_secret"],
      }).success,
    ).toBe(false);
  });
  it("accepts absent build identity as unknown", () => {
    expect(
      schemas.systemHealthVersionSchema.safeParse({
        version: null,
        commit: null,
        builtAt: null,
        sourceAt: null,
        observedAt: time,
      }).success,
    ).toBe(true);
  });
  it("keeps accounting separate from unknown storage reachability and integrity", () => {
    expect(
      schemas.systemHealthStorageSchema.safeParse({
        status: "healthy",
        customerBytes: 1,
        customerReservedBytes: 0,
        protectedBytes: 0,
        unit: "bytes",
        sourceAt: time,
        observedAt: time,
        reasons: [],
        reachability: "unknown",
        integrity: "unknown",
      }).success,
    ).toBe(true);
  });
  it("rejects forged customer query scope", () => {
    expect(schemas.customerSystemHealthQuerySchema.parse({})).toEqual({});
    expect(
      schemas.customerSystemHealthQuerySchema.safeParse({
        organizationId: "forged",
      }).success,
    ).toBe(false);
  });
});

describe("health measurement integrity", () => {
  it.each([
    "pending",
    "running",
    "retrying",
    "waitingForReview",
    "uncertainDelivery",
    "failedTerminal",
  ])("bounds %s and qualifies capped values", (field) => {
    expect(
      schemas.systemHealthQueueSchema.safeParse({
        ...queue,
        [field]: 10001,
        countRelation: "at_least",
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthQueueSchema.safeParse({
        ...queue,
        [field]: 10000,
        countRelation: "exact",
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthQueueSchema.safeParse({
        ...queue,
        [field]: 10000,
        countRelation: "at_least",
      }).success,
    ).toBe(true);
    expect(
      schemas.systemHealthQueueSchema.safeParse({ ...queue, [field]: null })
        .success,
    ).toBe(false);
  });
  it("requires oldest pending source data for uncapped backlog", () => {
    expect(
      schemas.systemHealthQueueSchema.safeParse({ ...queue, pending: 1 })
        .success,
    ).toBe(false);
    expect(
      schemas.systemHealthQueueSchema.safeParse({
        ...queue,
        pending: 1,
        oldestPendingAt: time,
      }).success,
    ).toBe(true);
  });
  it("never turns unavailable measurements into zero", () => {
    const unavailable = {
      ...queue,
      availability: "unavailable",
      pending: null,
      running: null,
      retrying: null,
      waitingForReview: null,
      uncertainDelivery: null,
      failedTerminal: null,
      countRelation: null,
      sourceAt: null,
      observedAt: time,
      reasons: ["source_unavailable"],
    };
    expect(schemas.systemHealthQueueSchema.safeParse(unavailable).success).toBe(
      true,
    );
    for (const field of [
      "pending",
      "running",
      "retrying",
      "waitingForReview",
      "uncertainDelivery",
      "failedTerminal",
    ]) {
      expect(
        schemas.systemHealthQueueSchema.safeParse({
          ...unavailable,
          [field]: 0,
        }).success,
      ).toBe(false);
    }
    expect(
      schemas.systemHealthQueueSchema.safeParse({
        ...unavailable,
        status: "healthy",
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthQueueSchema.safeParse({ ...unavailable, reasons: [] })
        .success,
    ).toBe(false);
  });
  it("requires both source and collector timestamps for available measurements", () => {
    expect(
      schemas.systemHealthQueueSchema.safeParse({ ...queue, sourceAt: null })
        .success,
    ).toBe(false);
    expect(
      schemas.systemHealthQueueSchema.safeParse({ ...queue, observedAt: null })
        .success,
    ).toBe(false);
  });
  it("does not disclose partial unknown storage accounting", () => {
    const storage = {
      status: "unknown",
      customerBytes: null,
      customerReservedBytes: null,
      protectedBytes: null,
      unit: "bytes",
      sourceAt: null,
      observedAt: time,
      reasons: ["meter_unavailable"],
      reachability: "unknown",
      integrity: "unknown",
    };
    expect(schemas.systemHealthStorageSchema.safeParse(storage).success).toBe(
      true,
    );
    expect(
      schemas.systemHealthStorageSchema.safeParse({
        ...storage,
        customerBytes: 0,
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthStorageSchema.safeParse({ ...storage, reasons: [] })
        .success,
    ).toBe(false);
    expect(
      schemas.systemHealthStorageSchema.safeParse({
        ...storage,
        status: "healthy",
      }).success,
    ).toBe(false);
  });
  it("does not fabricate unknown backup execution or restore assurance", () => {
    const backup = {
      lastExecutionAt: null,
      lastVerifiedRestoreAt: null,
      sourceAt: null,
      observedAt: time,
      status: "unknown",
      reasons: ["m15_05_not_available"],
    };
    expect(schemas.systemHealthBackupSchema.safeParse(backup).success).toBe(
      true,
    );
    expect(
      schemas.systemHealthBackupSchema.safeParse({
        ...backup,
        lastExecutionAt: time,
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthBackupSchema.safeParse({
        ...backup,
        lastVerifiedRestoreAt: time,
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthBackupSchema.safeParse({ ...backup, reasons: [] })
        .success,
    ).toBe(false);
  });
  it("rejects unknown source and unsafe reason values independently", () => {
    const component = {
      id: "database",
      label: "Database",
      status: "unknown",
      source: "supabase",
      sourceAt: null,
      observedAt: time,
      summary: "Unavailable",
      reasons: ["source_unavailable"],
    };
    expect(
      schemas.systemHealthComponentSchema.safeParse(component).success,
    ).toBe(true);
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        ...component,
        reasons: ["password_is_secret"],
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        ...component,
        source: "internal_host",
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        ...component,
        status: "healthy",
      }).success,
    ).toBe(false);
  });
});

it("rejects customer backup claims without current backup authority", () => {
  expect(
    schemas.systemHealthBackupSchema.safeParse({
      status: "healthy",
      lastExecutionAt: time,
      lastVerifiedRestoreAt: time,
      sourceAt: time,
      observedAt: time,
      reasons: [],
    }).success,
  ).toBe(false);
});

it("links usage to the existing licence settings authority", () => {
  const licence = {
    state: null,
    expiresAt: null,
    graceEndsAt: null,
    managementUrl: null,
    usageUrl: "/organization?settings=licence",
    sourceAt: null,
    observedAt: time,
  };
  expect(schemas.systemHealthLicenceLinkSchema.safeParse(licence).success).toBe(
    true,
  );
  expect(
    schemas.systemHealthLicenceLinkSchema.safeParse({
      ...licence,
      usageUrl: "/organization?settings=usage",
    }).success,
  ).toBe(false);
});

describe("backup component authority", () => {
  const backup = {
    id: "backups",
    label: "Backups",
    source: "m15_05",
    status: "unknown",
    sourceAt: null,
    observedAt: time,
    summary: "Backup assurance unavailable",
    reasons: ["m15_05_not_available"],
  };
  it("retains a valid unknown backup component", () => {
    expect(schemas.systemHealthComponentSchema.safeParse(backup).success).toBe(
      true,
    );
  });
  it("rejects fabricated healthy backup components with source timestamps", () => {
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        ...backup,
        status: "healthy",
        sourceAt: time,
        reasons: [],
      }).success,
    ).toBe(false);
  });
  it("rejects source timestamps without current backup authority", () => {
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        ...backup,
        sourceAt: time,
      }).success,
    ).toBe(false);
  });
  it("requires the explicit unavailable-authority reason", () => {
    expect(
      schemas.systemHealthComponentSchema.safeParse({ ...backup, reasons: [] })
        .success,
    ).toBe(false);
  });
  it("binds the backup component to its sole authority", () => {
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        ...backup,
        source: "supabase",
      }).success,
    ).toBe(false);
  });
  it("does not permit another component to claim backup authority", () => {
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        ...backup,
        id: "database",
      }).success,
    ).toBe(false);
    expect(
      schemas.systemHealthComponentSchema.safeParse({
        ...backup,
        id: "database",
        status: "healthy",
        sourceAt: time,
        reasons: [],
      }).success,
    ).toBe(false);
  });
});
