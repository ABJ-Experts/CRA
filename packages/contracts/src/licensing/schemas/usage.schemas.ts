import { z } from "zod";
import {
  LICENSE_CAPABILITIES,
  licenseCapabilitySchema,
  licenseStateSchema,
} from "./license-values.schemas.js";

export const LICENSE_USAGE_DEFINITIONS = [
  {
    id: "seats",
    label: "Seats",
    unit: "seats",
    definition:
      "Active organization members plus distinct live pending invitation reservations; active member emails are not reserved twice.",
    componentKeys: ["activeMembers", "reservedInvitations"],
  },
  {
    id: "products",
    label: "Products",
    unit: "products",
    definition:
      "Organization products whose archived_at is null; archiving changes this gauge without deleting storage.",
    componentKeys: ["products"],
  },
  {
    id: "storage",
    label: "Customer storage",
    unit: "bytes",
    definition:
      "Completed customer storage plus reserved, uploading and uncertain customer bytes; protected inputs and generated artifacts are excluded.",
    componentKeys: ["storageBytes", "storageReservedBytes"],
  },
  {
    id: "protected_storage",
    label: "Protected storage",
    unit: "bytes",
    definition:
      "Deduplicated protected input and generated artifact bytes; informational and exempt from customer storage limits.",
    componentKeys: ["protectedStorageBytes"],
  },
] as const;

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime({ offset: false });
const reasons = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,99}$/)).max(30);
export const licenseUsageCounterIdSchema = z.enum([
  "seats",
  "products",
  "storage",
  "protected_storage",
]);
export const licenseUsageComponentsSchema = z
  .object({
    activeMembers: integer.nullable(),
    reservedInvitations: integer.nullable(),
    products: integer.nullable(),
    storageBytes: integer.nullable(),
    storageReservedBytes: integer.nullable(),
    protectedStorageBytes: integer.nullable(),
  })
  .strict();
export const licenseUsageLimitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("finite"), value: integer }).strict(),
  z.object({ kind: z.literal("unlimited"), value: z.null() }).strict(),
  z.object({ kind: z.literal("unverified"), value: z.null() }).strict(),
  z.object({ kind: z.literal("exempt"), value: z.null() }).strict(),
]);
export const licenseUsageCounterSchema = z
  .object({
    id: licenseUsageCounterIdSchema,
    label: z.string(),
    kind: z.literal("gauge"),
    unit: z.enum(["seats", "products", "bytes"]),
    scope: z.literal("organization"),
    definition: z.string(),
    period: z
      .object({
        kind: z.literal("current_state"),
        resetRule: z.literal("source_changes_only"),
        nextResetAt: z.null(),
      })
      .strict(),
    value: integer.nullable(),
    components: z
      .array(
        z
          .object({
            key: z.enum([
              "activeMembers",
              "reservedInvitations",
              "products",
              "storageBytes",
              "storageReservedBytes",
              "protectedStorageBytes",
            ]),
            value: integer.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2),
    availability: z.enum(["ready", "unavailable"]),
    limit: licenseUsageLimitSchema,
    state: z.enum([
      "normal",
      "near_limit",
      "at_limit",
      "over_limit",
      "unavailable",
    ]),
    reasons,
  })
  .strict()
  .refine((row) => {
    const definition = LICENSE_USAGE_DEFINITIONS.find(
      (item) => item.id === row.id,
    )!;
    return (
      row.label === definition.label &&
      row.unit === definition.unit &&
      row.definition === definition.definition &&
      row.components.length === definition.componentKeys.length &&
      row.components.every(
        (component, index) => component.key === definition.componentKeys[index],
      ) &&
      (row.id === "protected_storage"
        ? row.limit.kind === "exempt"
        : row.limit.kind !== "exempt")
    );
  }, "Counter definition differs from m15_02_v1")
  .refine((row) => {
    if (row.availability === "unavailable")
      return row.value === null && row.state === "unavailable";
    if (
      row.value === null ||
      row.components.some((component) => component.value === null)
    )
      return false;
    const total = row.components.reduce(
      (sum, component) => sum + BigInt(component.value!),
      0n,
    );
    if (total !== BigInt(row.value)) return false;
    if (row.limit.kind === "unverified") return row.state === "unavailable";
    if (row.limit.kind !== "finite") return row.state === "normal";
    const expected =
      row.value > row.limit.value
        ? "over_limit"
        : row.value === row.limit.value
          ? "at_limit"
          : BigInt(row.value) * 5n >= BigInt(row.limit.value) * 4n
            ? "near_limit"
            : "normal";
    return row.state === expected;
  }, "Counter value or diagnostic state is inconsistent");

export const licenseUsageSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    definitionVersion: z.literal("m15_02_v1"),
    organizationId: z.uuid(),
    observedAt: timestamp,
    meterVersion: integer,
    reconciledAt: timestamp.nullable(),
    license: z
      .object({
        version: integer,
        issuanceSequence: integer.min(1).nullable(),
        policyRevision: integer,
        state: licenseStateSchema.nullable(),
        verified: z.boolean(),
        reasons,
        startsAt: timestamp.nullable(),
        expiresAt: timestamp.nullable(),
        graceEndsAt: timestamp.nullable(),
        effectiveCapabilities: z
          .array(licenseCapabilitySchema)
          .max(LICENSE_CAPABILITIES.length)
          .refine(
            (items) => new Set(items).size === items.length,
            "Duplicate capabilities",
          ),
      })
      .strict(),
    counters: z.array(licenseUsageCounterSchema).length(4),
  })
  .strict()
  .refine(({ license }) => {
    if (!license.verified) return license.effectiveCapabilities.length === 0;
    return (
      license.version > 0 &&
      license.issuanceSequence !== null &&
      (license.state === "active" ||
        license.state === "grace" ||
        license.state === "expired_read_only") &&
      (license.state !== "expired_read_only" ||
        license.effectiveCapabilities.length === 0)
    );
  }, "Licence verification provenance contradicts capabilities or state")
  .refine(({ license, observedAt }) => {
    if (!license.verified) return true;
    if (
      license.startsAt === null ||
      license.expiresAt === null ||
      license.graceEndsAt === null
    )
      return false;
    const starts = Date.parse(license.startsAt);
    const expires = Date.parse(license.expiresAt);
    const grace = Date.parse(license.graceEndsAt);
    const observed = Date.parse(observedAt);
    if (starts >= expires || grace - expires !== 30 * 24 * 60 * 60 * 1000)
      return false;
    if (license.state === "active")
      return observed >= starts && observed < expires;
    if (license.state === "grace")
      return observed >= expires && observed < grace;
    return license.state === "expired_read_only" && observed >= grace;
  }, "Verified licence dates contradict observed state")
  .refine(
    (snapshot) =>
      snapshot.counters.every(
        (row, index) => row.id === LICENSE_USAGE_DEFINITIONS[index]!.id,
      ),
    "Counter order differs from m15_02_v1",
  )
  .refine(
    (snapshot) =>
      snapshot.counters.every(
        (row) =>
          row.id === "protected_storage" ||
          (snapshot.license.verified
            ? row.limit.kind !== "unverified"
            : row.limit.kind === "unverified"),
      ),
    "Unverified licence cannot supply a limit",
  )
  .refine(
    (snapshot) =>
      snapshot.reconciledAt === null ||
      Date.parse(snapshot.reconciledAt) <= Date.parse(snapshot.observedAt),
    "Reconciliation cannot follow observation",
  );

export const licenseUsageOperationInputSchema = z
  .object({
    expectedLicenseVersion: integer,
    expectedMeterVersion: integer,
    idempotencyKey: z.uuid(),
  })
  .strict();
export const licenseUsageExportResponseSchema = z
  .object({
    snapshot: licenseUsageSnapshotSchema,
    auditEventId: z.uuid(),
    replayed: z.boolean(),
  })
  .strict();
export const licenseUsageReconciliationResponseSchema = z
  .object({
    auditEventId: z.uuid(),
    meterVersion: integer,
    checked: integer.max(100),
    repaired: integer,
    released: integer.max(100),
    unresolved: integer,
    completedAt: timestamp,
    replayed: z.boolean(),
  })
  .strict();

export const licenseUsageQuerySchema = z.object({}).strict();
