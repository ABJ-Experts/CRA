import { describe, expect, it } from "vitest";

import {
  customerSystemHealthResponseSchema,
  systemHealthComponentSchema,
} from "./system-health.schema.js";

const timestamp = "2026-10-14T10:00:00.000Z";
const orgId = "11111111-1111-4111-8111-111111111111";

describe("customer system health schema", () => {
  it("accepts a tenant-scoped diagnostic snapshot with unknown backup assurance", () => {
    expect(
      customerSystemHealthResponseSchema.parse({
        schemaVersion: 1,
        organizationId: orgId,
        observedAt: timestamp,
        overallStatus: "degraded",
        currentVersion: {
          version: "1.2.3",
          commit: "4b5f677",
          builtAt: timestamp,
          sourceAt: timestamp,
          observedAt: timestamp,
        },
        licence: {
          state: "active",
          expiresAt: "2026-11-14T10:00:00.000Z",
          managementUrl: "/organization?settings=licence",
          usageUrl: null,
          graceEndsAt: null,
          sourceAt: timestamp,
          observedAt: timestamp,
        },
        components: [
          {
            id: "database",
            label: "Database",
            status: "healthy",
            observedAt: timestamp,
            sourceAt: timestamp,
            source: "supabase",
            summary: "Reachable",
            reasons: [],
          },
          {
            id: "backups",
            label: "Backups",
            status: "unknown",
            observedAt: null,
            sourceAt: null,
            source: "m15_05",
            summary: "Backup assurance is not configured",
            reasons: ["m15_05_not_available"],
          },
        ],
        queues: [
          {
            id: "vulnerability_feeds",
            label: "Vulnerability feeds",
            availability: "ready",
            interpretation: "queue_observation",
            reasons: [],
            sourceAt: timestamp,
            uncertainDelivery: 0,
            pending: 3,
            running: 1,
            retrying: 2,
            waitingForReview: 0,
            failedTerminal: 1,
            oldestPendingAt: timestamp,
            countRelation: "exact",
            observedAt: timestamp,
            status: "degraded",
          },
        ],
        storage: {
          status: "healthy",
          customerBytes: 100,
          customerReservedBytes: 5,
          protectedBytes: 25,
          unit: "bytes",
          sourceAt: timestamp,
          reachability: "unknown",
          integrity: "unknown",
          observedAt: timestamp,
          reasons: [],
        },
        feedFreshness: [
          {
            id: "nvd",
            sourceAt: timestamp,
            label: "NVD",
            status: "stale",
            lastSuccessAt: "2026-10-12T10:00:00.000Z",
            lastSourceSnapshotAt: "2026-10-12T09:00:00.000Z",
            staleAfterSeconds: 86_400,
            observedAt: timestamp,
            reasons: ["source_stale"],
          },
        ],
        backup: {
          lastExecutionAt: null,
          sourceAt: null,
          observedAt: timestamp,
          lastVerifiedRestoreAt: null,
          status: "unknown",
          reasons: ["m15_05_not_available"],
        },
        evidenceExportPreserved: true,
      }),
    ).toMatchObject({ overallStatus: "degraded" });
  });

  it("rejects private host and object details", () => {
    const result = systemHealthComponentSchema.safeParse({
      id: "database",
      label: "Database",
      status: "healthy",
      observedAt: timestamp,
      sourceAt: timestamp,
      source: "supabase",
      summary: "Reachable",
      hostname: "db.internal.local",
      reasons: [],
    });

    expect(result.success).toBe(false);
  });

  it("requires capped queue counts to declare at_least", () => {
    const result = customerSystemHealthResponseSchema.safeParse({
      schemaVersion: 1,
      organizationId: orgId,
      observedAt: timestamp,
      overallStatus: "healthy",
      currentVersion: {
        version: "1",
        commit: null,
        builtAt: null,
        sourceAt: null,
        observedAt: timestamp,
      },
      licence: {
        state: null,
        expiresAt: null,
        managementUrl: null,
        usageUrl: null,
        graceEndsAt: null,
        sourceAt: null,
        observedAt: timestamp,
      },
      components: [],
      queues: [
        {
          id: "exports",
          label: "Exports",
          availability: "ready",
          interpretation: "queue_observation",
          reasons: [],
          sourceAt: timestamp,
          uncertainDelivery: 0,
          pending: 10_000,
          running: 0,
          retrying: 0,
          waitingForReview: 0,
          failedTerminal: 0,
          oldestPendingAt: null,
          countRelation: "exact",
          observedAt: timestamp,
          status: "healthy",
        },
      ],
      storage: {
        status: "unknown",
        customerBytes: null,
        customerReservedBytes: null,
        protectedBytes: null,
        unit: "bytes",
        sourceAt: timestamp,
        reachability: "unknown",
        integrity: "unknown",
        observedAt: null,
        reasons: ["meter_unavailable"],
      },
      feedFreshness: [],
      backup: {
        lastExecutionAt: null,
        sourceAt: null,
        observedAt: timestamp,
        lastVerifiedRestoreAt: null,
        status: "unknown",
        reasons: ["m15_05_not_available"],
      },
      evidenceExportPreserved: true,
    });

    expect(result.success).toBe(false);
  });
});
