import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";
import {
  releaseLifecycleStateSchema,
  releaseMarketAvailabilityWarningSchema,
  utcZDateTimeSchema,
} from "./release-market-lifecycle.schema.js";
import { z } from "zod";

const requiredText = (maxLength: number) =>
  z.string().trim().min(1).max(maxLength);
const optionalText = (maxLength: number) => requiredText(maxLength).optional();
const nullableText = (maxLength: number) => requiredText(maxLength).nullable();
const expectedVersionSchema = z.number().int().nonnegative();

/** Display values are preserved; the database owns the normalized uniqueness key. */
export const productInternalCodeSchema = requiredText(128);
export const productTypeSchema = z.enum([
  "hardware_with_software",
  "standalone_software",
  "component",
  "remote_data_processing",
]);
/** @deprecated Prefer releaseLifecycleStateSchema. Kept for existing import paths. */
export const releaseLifecycleSchema = releaseLifecycleStateSchema;

export const productParamsSchema = z.object({ productId: z.uuid() }).strict();
export const releaseParamsSchema = z
  .object({ productId: z.uuid(), releaseId: z.uuid() })
  .strict();

export const createProductInputSchema = z
  .object({
    name: requiredText(200),
    internalCode: productInternalCodeSchema,
    productType: productTypeSchema,
    description: optionalText(4_000),
    responsibleOwnerId: z.uuid(),
    legalEntityId: z.uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const updateProductInputSchema = z
  .object({
    name: requiredText(200).optional(),
    internalCode: productInternalCodeSchema.optional(),
    productType: productTypeSchema.optional(),
    description: nullableText(4_000).optional(),
    responsibleOwnerId: z.uuid().optional(),
    expectedVersion: expectedVersionSchema,
  })
  .strict()
  .refine(
    ({ name, internalCode, productType, description, responsibleOwnerId }) =>
      name !== undefined ||
      internalCode !== undefined ||
      productType !== undefined ||
      description !== undefined ||
      responsibleOwnerId !== undefined,
    "Provide at least one product field to update",
  );

export const archiveProductInputSchema = z
  .object({ expectedVersion: expectedVersionSchema, reason: optionalText(500) })
  .strict();

export const moveProductLegalEntityInputSchema = z
  .object({
    legalEntityId: z.uuid(),
    expectedVersion: expectedVersionSchema,
    reason: requiredText(500),
  })
  .strict();

export const createReleaseInputSchema = z
  .object({
    label: requiredText(200),
    version: requiredText(200),
    description: optionalText(4_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const updateReleaseInputSchema = z
  .object({
    label: requiredText(200).optional(),
    version: requiredText(200).optional(),
    description: nullableText(4_000).optional(),
    expectedVersion: expectedVersionSchema,
  })
  .strict()
  .refine(
    ({ label, version, description }) =>
      label !== undefined || version !== undefined || description !== undefined,
    "Provide at least one release field to update",
  );

export const archiveReleaseInputSchema = z
  .object({ expectedVersion: expectedVersionSchema, reason: optionalText(500) })
  .strict();

const rawBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** A bounded, deterministic repository query. `q` is intentionally plain text. */
export const productListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
    q: z.string().trim().min(1).max(200).optional(),
    archived: rawBoolean.optional(),
    productType: productTypeSchema.optional(),
    responsibleOwnerId: z.uuid().optional(),
  })
  .strict();

export const releaseListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
    archived: rawBoolean.optional(),
    lifecycle: releaseLifecycleSchema.optional(),
  })
  .strict();

export const productLegalEntitySnapshotSchema = z
  .object({
    id: z.uuid(),
    identifier: z.string().min(1).max(64),
    legalName: z.string().min(1).max(200),
    mainEstablishmentCountry: z.string().length(2),
    version: expectedVersionSchema,
  })
  .strict();

export const productSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: requiredText(200),
    internalCode: productInternalCodeSchema,
    productType: productTypeSchema,
    description: z.string().min(1).max(4_000).nullable(),
    responsibleOwnerId: z.uuid(),
    legalEntity: productLegalEntitySnapshotSchema,
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    version: expectedVersionSchema,
    releaseCount: z.number().int().nonnegative(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
    updatedBy: z.uuid(),
  })
  .strict();

export const releaseSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    label: requiredText(200),
    version: requiredText(200),
    description: z.string().min(1).max(4_000).nullable(),
    lifecycle: releaseLifecycleSchema,
    placedOnMarketAt: utcZDateTimeSchema.nullable(),
    marketAvailabilityWarning:
      releaseMarketAvailabilityWarningSchema.nullable(),
    legalEntity: productLegalEntitySnapshotSchema,
    archivedAt: z.iso.datetime({ offset: true }).nullable(),
    versionNumber: expectedVersionSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    createdBy: z.uuid(),
    updatedBy: z.uuid(),
  })
  .strict();

export const productResponseSchema = z
  .object({ product: productSchema })
  .strict();
export const productsResponseSchema = z
  .object({ products: pagedSchema(productSchema) })
  .strict();
export const releaseResponseSchema = z
  .object({ release: releaseSchema })
  .strict();
export const releasesResponseSchema = z
  .object({ releases: pagedSchema(releaseSchema) })
  .strict();
