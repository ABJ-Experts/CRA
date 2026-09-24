import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

const key = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:[a-z0-9._-]*[a-z0-9])?$/);
const plainText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) => !/[\p{Cc}\p{Cf}]/u.test(value) && !/<[^>]+>/u.test(value),
      "Control characters and HTML markup are not allowed",
    );
const date = z.iso.date();
const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const frameworkPackKeySchema = key;
export const frameworkVersionKeySchema = key;
export const frameworkRequirementKeySchema = key;

/** Stable across display-label changes; consumers persist all three keys. */
export const frameworkRequirementReferenceSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
    requirementKey: frameworkRequirementKeySchema,
  })
  .strict();

const packRequirementSchema = z
  .object({
    requirementKey: frameworkRequirementKeySchema,
    identifier: plainText(120),
    parentKey: frameworkRequirementKeySchema.nullable(),
    position: z.number().int().min(1).max(10_000),
    heading: plainText(500).nullable(),
    text: plainText(20_000),
    sourceReference: plainText(500),
  })
  .strict();

/** Deployment-only input. The database independently enforces identity and atomicity. */
export const frameworkPackImportSchema = z
  .object({
    schemaVersion: z.literal(1),
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
    title: plainText(300),
    editionDate: date,
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    sourceUrl: z.url().startsWith("https://").max(2_048),
    sourceCelex: plainText(80),
    sourceEli: z
      .url()
      .max(2_048)
      .refine(
        (value) =>
          value.startsWith("https://") ||
          value.startsWith("http://data.europa.eu/"),
        "Use HTTPS or the canonical EU ELI URL",
      ),
    sourcePublicationDate: date,
    attribution: plainText(1_000),
    reviewEvidence: plainText(1_000),
    requirements: z.array(packRequirementSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((pack, context) => {
    if (JSON.stringify(pack).length > 2_097_152) {
      context.addIssue({ code: "custom", message: "Pack exceeds 2 MB" });
    }
    const byKey = new Map(
      pack.requirements.map((item) => [item.requirementKey, item]),
    );
    if (byKey.size !== pack.requirements.length) {
      context.addIssue({
        code: "custom",
        message: "Duplicate requirement key",
      });
    }
    if (
      new Set(pack.requirements.map((item) => item.identifier)).size !==
      pack.requirements.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Duplicate human-readable identifier",
      });
    }
    const siblings = new Set<string>();
    for (const item of pack.requirements) {
      if (item.parentKey !== null && !byKey.has(item.parentKey)) {
        context.addIssue({
          code: "custom",
          message: `Missing parent for ${item.requirementKey}`,
        });
      }
      const siblingPosition = `${item.parentKey ?? "root"}:${item.position}`;
      if (siblings.has(siblingPosition)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate sibling position ${siblingPosition}`,
        });
      }
      siblings.add(siblingPosition);
      const seen = new Set<string>();
      let current: typeof item | undefined = item;
      while (current) {
        if (seen.has(current.requirementKey)) {
          context.addIssue({
            code: "custom",
            message: `Cycle at ${item.requirementKey}`,
          });
          break;
        }
        seen.add(current.requirementKey);
        if (seen.size > 10) {
          context.addIssue({
            code: "custom",
            message: `Tree exceeds depth nine at ${item.requirementKey}`,
          });
          break;
        }
        current =
          current.parentKey === null ? undefined : byKey.get(current.parentKey);
      }
    }
  });

export const frameworkCatalogResponseSchema = z
  .object({
    packs: z
      .array(
        z
          .object({
            packKey: frameworkPackKeySchema,
            title: plainText(300),
            versions: z
              .array(
                z
                  .object({
                    versionKey: frameworkVersionKeySchema,
                    editionDate: date,
                    language: plainText(12),
                    sourceUrl: z.url().startsWith("https://").max(2_048),
                    sourceReference: plainText(500),
                    attribution: plainText(1_000),
                    contentHash: hash,
                  })
                  .strict(),
              )
              .max(100),
            selection: z
              .object({
                versionKey: frameworkVersionKeySchema,
                enabled: z.boolean(),
                revision: z.number().int().min(1),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const frameworkTreeParamsSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
  })
  .strict();

export const frameworkTreeQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    cursor: z.string().min(1).max(128).optional(),
  })
  .strict();

export const frameworkTreeResponseSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
    editionDate: date,
    language: plainText(12),
    requirements: z
      .array(
        packRequirementSchema.extend({
          depth: z.number().int().min(0).max(9),
        }),
      )
      .max(100),
    nextCursor: z.string().min(1).max(128).nullable(),
  })
  .strict();

export const frameworkSelectionParamsSchema = z
  .object({
    packKey: frameworkPackKeySchema,
  })
  .strict();

export const selectFrameworkInputSchema = z
  .object({
    versionKey: frameworkVersionKeySchema,
    enabled: z.boolean(),
    expectedRevision: z.number().int().min(1).nullable(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const frameworkSelectionResponseSchema = z
  .object({
    packKey: frameworkPackKeySchema,
    versionKey: frameworkVersionKeySchema,
    enabled: z.boolean(),
    revision: z.number().int().min(1),
  })
  .strict();
