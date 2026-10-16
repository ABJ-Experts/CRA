import { describe, expect, it } from "vitest";
import {
  customerSystemHealthQuerySchema,
  systemHealthComponentSchema,
} from "./system-health.schema.js";
import {
  customerSystemHealthV2QuerySchema,
  systemHealthV2ComponentSchema,
  customerSystemHealthVersionedQuerySchema,
} from "./system-health-v2.schema.js";
const component = {
  id: "backups",
  source: "m15_05",
  label: "Backups",
  status: "healthy",
  sourceAt: "2026-10-14T10:00:00.000Z",
  observedAt: "2026-10-14T10:00:00.000Z",
  summary: "Verified clean restoration",
  reasons: [],
};
describe("opt-in backup health authority", () => {
  it("preserves strict default v1 query and unknown backup authority", () => {
    expect(customerSystemHealthQuerySchema.parse({})).toEqual({});
    expect(
      customerSystemHealthQuerySchema.safeParse({ schemaVersion: "2" }).success,
    ).toBe(false);
    expect(systemHealthComponentSchema.safeParse(component).success).toBe(
      false,
    );
  });
  it("accepts explicit version2 only and allows proven backup components", () => {
    expect(
      customerSystemHealthV2QuerySchema.parse({ schemaVersion: "2" }),
    ).toEqual({ schemaVersion: 2 });
    expect(
      customerSystemHealthV2QuerySchema.parse({ schemaVersion: 2 }),
    ).toEqual({ schemaVersion: 2 });
    expect(customerSystemHealthVersionedQuerySchema.parse({})).toEqual({});
    expect(systemHealthV2ComponentSchema.parse(component)).toEqual(component);
    for (const schemaVersion of ["1", 3, true, "02", null])
      expect(
        customerSystemHealthV2QuerySchema.safeParse({ schemaVersion }).success,
      ).toBe(false);
    expect(
      systemHealthV2ComponentSchema.safeParse({ ...component, sourceAt: null })
        .success,
    ).toBe(false);
    expect(
      systemHealthV2ComponentSchema.safeParse({
        ...component,
        source: "supabase",
      }).success,
    ).toBe(false);
  });
});

it("parses version2 responses and refuses an unverified healthy backup component", async () => {
  const {
    customerSystemHealthV2ResponseSchema,
    customerSystemHealthVersionedResponseSchema,
  } = await import("./system-health-v2.schema.js");
  const at = "2026-10-14T10:00:00.000Z";
  const response = {
    schemaVersion: 2,
    organizationId: "11111111-1111-4111-8111-111111111111",
    observedAt: at,
    overallStatus: "unknown",
    currentVersion: {
      version: null,
      commit: null,
      builtAt: null,
      sourceAt: null,
      observedAt: at,
    },
    licence: {
      state: null,
      expiresAt: null,
      graceEndsAt: null,
      managementUrl: null,
      usageUrl: null,
      sourceAt: null,
      observedAt: at,
    },
    components: [],
    queues: [],
    feedFreshness: [],
    evidenceExportPreserved: true,
    storage: {
      status: "unknown",
      customerBytes: null,
      customerReservedBytes: null,
      protectedBytes: null,
      unit: "bytes",
      sourceAt: null,
      observedAt: at,
      reasons: ["meter_unavailable"],
      reachability: "unknown",
      integrity: "unknown",
    },
    backup: {
      status: "unavailable",
      lastAttempt: null,
      lastCapture: null,
      lastVerification: null,
      lastVerifiedRestoreAt: null,
      recoverablePointAt: null,
      verificationDueAt: null,
      residency: null,
      sourceAt: null,
      observedAt: at,
      reasons: ["not_configured"],
    },
  };
  expect(
    customerSystemHealthV2ResponseSchema.parse(response).schemaVersion,
  ).toBe(2);
  expect(
    customerSystemHealthVersionedResponseSchema.parse(response).schemaVersion,
  ).toBe(2);
  expect(
    customerSystemHealthV2ResponseSchema.safeParse({
      ...response,
      components: [component],
    }).success,
  ).toBe(false);
  expect(
    customerSystemHealthV2ResponseSchema.safeParse({
      ...response,
      schemaVersion: 1,
    }).success,
  ).toBe(false);
});
