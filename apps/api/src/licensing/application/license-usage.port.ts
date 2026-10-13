import { z } from "zod";
import {
  licenseUsageComponentsSchema,
  licenseUsageExportResponseSchema,
  licenseUsageReconciliationResponseSchema,
} from "@repo/contracts/licensing/schemas";
import type {
  LicenseCurrentResponse,
  LicenseUsageOperationInput,
  LicenseUsageSnapshot,
} from "@repo/contracts/licensing/types";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const availability = z.enum(["ready", "unavailable"]);
const reasons = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)).max(30);
export const usageProjectionSchema = z
  .object({
    outcome: z.enum(["ready", "unavailable"]),
    organizationId: z.uuid(),
    observedAt: z.iso.datetime(),
    licenseVersion: integer,
    policyRevision: integer.nullable(),
    issuanceSequence: integer.min(1).nullable(),
    meterVersion: integer,
    reconciledAt: z.iso.datetime().nullable(),
    components: licenseUsageComponentsSchema,
    availability: z
      .object({
        seats: availability,
        products: availability,
        storage: availability,
        protected_storage: availability,
      })
      .strict(),
    reasons: z
      .object({
        seats: reasons,
        products: reasons,
        storage: reasons,
        protected_storage: reasons,
      })
      .strict(),
  })
  .strict();
export type UsageProjection = z.output<typeof usageProjectionSchema>;
export const usageReadResultSchema = z.union([
  usageProjectionSchema,
  z.object({ outcome: z.enum(["forbidden", "conflict"]) }).strict(),
]);
const failureSchema = z
  .object({ outcome: z.enum(["forbidden", "conflict", "busy"]) })
  .strict();
export const usageExportResultSchema = z.union([
  licenseUsageExportResponseSchema
    .extend({ outcome: z.enum(["exported", "replayed"]) })
    .strict(),
  failureSchema,
]);
export const usageReconcileResultSchema = z.union([
  licenseUsageReconciliationResponseSchema
    .extend({ outcome: z.enum(["reconciled", "replayed"]) })
    .strict(),
  failureSchema,
]);
export const usageReceiptResultSchema = z.union([
  z
    .object({
      outcome: z.literal("replayed"),
      receipt: z.union([
        licenseUsageExportResponseSchema
          .extend({ outcome: z.enum(["exported", "replayed"]) })
          .strict(),
        licenseUsageReconciliationResponseSchema
          .extend({ outcome: z.enum(["reconciled", "replayed"]) })
          .strict(),
      ]),
    })
    .strict(),
  z.object({ outcome: z.enum(["absent", "conflict", "forbidden"]) }).strict(),
]);
export type UsageOperation = "export" | "reconcile";
export interface UsageCommand extends LicenseUsageOperationInput {
  requestDigest: string;
}
export interface LicenseUsagePort {
  read(
    orgId: string,
    actorId: string,
    expectedLicenseVersion: number | null,
  ): Promise<z.output<typeof usageReadResultSchema>>;
  receipt(
    orgId: string,
    actorId: string,
    operation: UsageOperation,
    command: UsageCommand,
  ): Promise<z.output<typeof usageReceiptResultSchema>>;
  export(
    orgId: string,
    actorId: string,
    command: UsageCommand,
    snapshot: LicenseUsageSnapshot,
  ): Promise<z.output<typeof usageExportResultSchema>>;
  reconcile(
    orgId: string,
    actorId: string,
    command: UsageCommand,
  ): Promise<z.output<typeof usageReconcileResultSchema>>;
}
export interface LicenseUsageContext {
  getCurrent(orgId: string, actorId: string): Promise<LicenseCurrentResponse>;
  readonly instanceConfigured: boolean;
  readonly policyRevision: number;
}
