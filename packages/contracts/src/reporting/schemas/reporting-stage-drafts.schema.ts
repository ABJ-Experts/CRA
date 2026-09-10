import { memberStateCountryCodeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { z } from "zod";

import {
  reportingActorSnapshotSchema,
  reportingObligationStageKindSchema,
  utcSecondDateTimeSchema,
} from "./reporting-obligations.schema.js";
import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const expectedRevisionSchema = z.number().int().nonnegative();
const revisionSchema = z.number().int().positive();
const fieldKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const reportingStageFieldTypeSchema = z.enum([
  "short_text",
  "long_text",
  "boolean",
  "member_states",
]);

/** A declarative condition whose value is evaluated by the server against the same draft. */
export const reportingStageFieldConditionSchema = z
  .object({
    fieldKey: fieldKeySchema,
    equals: z.union([z.string().trim().min(1).max(4_000), z.boolean()]),
  })
  .strict();

export const reportingStageFieldDefinitionSchema = z
  .object({
    key: fieldKeySchema,
    label: requiredText(200),
    description: z.string().trim().max(2_000).nullable(),
    type: reportingStageFieldTypeSchema,
    required: z.boolean(),
    requiredWhen: reportingStageFieldConditionSchema.nullable(),
    templateEligible: z.boolean(),
  })
  .strict()
  .superRefine((field, context) => {
    if (field.type === "member_states" && field.templateEligible) {
      context.addIssue({
        code: "custom",
        path: ["templateEligible"],
        message:
          "Release-scoped Member States cannot be copied by a family template",
      });
    }
  });

export const reportingStageFieldValueSchema = z.discriminatedUnion("type", [
  z
    .object({
      key: fieldKeySchema,
      type: z.literal("short_text"),
      value: z.string().trim().max(4_000).nullable(),
    })
    .strict(),
  z
    .object({
      key: fieldKeySchema,
      type: z.literal("long_text"),
      value: z.string().trim().max(20_000).nullable(),
    })
    .strict(),
  z
    .object({
      key: fieldKeySchema,
      type: z.literal("boolean"),
      value: z.boolean().nullable(),
    })
    .strict(),
  z
    .object({
      key: fieldKeySchema,
      type: z.literal("member_states"),
      value: z.array(memberStateCountryCodeSchema).min(1).max(27).nullable(),
    })
    .strict(),
]);

export const reportingStageFieldProvenanceSchema = z.discriminatedUnion(
  "origin",
  [
    z
      .object({
        origin: z.literal("human"),
        actor: reportingActorSnapshotSchema,
        recordedAt: utcSecondDateTimeSchema,
      })
      .strict(),
    z
      .object({
        origin: z.literal("platform"),
        source: requiredText(500),
        recordedAt: utcSecondDateTimeSchema,
      })
      .strict(),
    z
      .object({
        origin: z.literal("ai_accepted"),
        acceptedBy: reportingActorSnapshotSchema,
        acceptedAt: utcSecondDateTimeSchema,
        suggestionReference: requiredText(500),
      })
      .strict(),
  ],
);

export const reportingStageDraftFieldSchema = z
  .object({
    value: reportingStageFieldValueSchema,
    provenance: reportingStageFieldProvenanceSchema,
    updatedAt: utcSecondDateTimeSchema,
  })
  .strict();

export const reportingStageMemberStateSchema = z
  .object({
    countryCode: memberStateCountryCodeSchema,
    provenance: reportingStageFieldProvenanceSchema,
  })
  .strict();

export const reportingStageDraftCompletenessSchema = z.enum([
  "incomplete",
  "valid",
]);
export const reportingStageDraftStatusSchema = z.enum([
  "editable",
  "locked",
  "conflict",
  "submitted",
]);

export const reportingStageDraftLockSchema = z
  .object({
    heldBy: reportingActorSnapshotSchema,
    expiresAt: utcSecondDateTimeSchema,
  })
  .strict();

const reportingStageDraftBaseSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    obligationId: z.uuid(),
    stageId: z.uuid(),
    releaseId: z.uuid(),
    stage: reportingObligationStageKindSchema,
    revision: revisionSchema,
    status: reportingStageDraftStatusSchema,
    completeness: reportingStageDraftCompletenessSchema,
    fieldDefinitions: z
      .array(reportingStageFieldDefinitionSchema)
      .min(1)
      .max(100),
    fields: z.array(reportingStageDraftFieldSchema).max(100),
    // A release without market-availability data is representable as an incomplete
    // draft. Submission still requires the stage specification's Member States.
    memberStates: z.array(reportingStageMemberStateSchema).max(27),
    prepopulatedFromSubmissionId: z.uuid().nullable(),
    requiresTemplateReview: z.boolean(),
    lock: reportingStageDraftLockSchema.nullable(),
    createdBy: reportingActorSnapshotSchema,
    createdAt: utcSecondDateTimeSchema,
    updatedAt: utcSecondDateTimeSchema,
  })
  .strict()
  .superRefine((draft, context) => {
    const definitionKeys = new Set<string>();
    for (const [index, definition] of draft.fieldDefinitions.entries()) {
      if (definitionKeys.has(definition.key)) {
        context.addIssue({
          code: "custom",
          path: ["fieldDefinitions", index, "key"],
          message: "Field definition keys must be unique",
        });
      }
      definitionKeys.add(definition.key);
    }
    const fieldKeys = new Set<string>();
    for (const [index, field] of draft.fields.entries()) {
      const definition = draft.fieldDefinitions.find(
        (candidate) => candidate.key === field.value.key,
      );
      if (
        fieldKeys.has(field.value.key) ||
        definition === undefined ||
        definition.type !== field.value.type
      ) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "value", "key"],
          message: "Draft fields must be unique declared fields",
        });
      }
      fieldKeys.add(field.value.key);
    }
    if (draft.status === "locked" && draft.lock === null) {
      context.addIssue({
        code: "custom",
        path: ["lock"],
        message: "Locked drafts require lock metadata",
      });
    }
    if (draft.status !== "locked" && draft.lock !== null) {
      context.addIssue({
        code: "custom",
        path: ["lock"],
        message: "Only locked drafts expose lock metadata",
      });
    }
  });

export const reportingStageDraftSchema = reportingStageDraftBaseSchema;

export const reportingStageSubmissionSnapshotSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    draftId: z.uuid(),
    obligationId: z.uuid(),
    stageId: z.uuid(),
    releaseId: z.uuid(),
    stage: reportingObligationStageKindSchema,
    draftRevision: revisionSchema,
    fields: z.array(reportingStageDraftFieldSchema).max(100),
    memberStates: z.array(reportingStageMemberStateSchema).max(27),
    submittedBy: reportingActorSnapshotSchema,
    submittedAt: utcSecondDateTimeSchema,
    submissionReference: requiredText(1_000),
  })
  .strict();

export const reportingStageDraftConflictSchema = z
  .object({
    code: z.literal("stale_revision"),
    message: z.literal(
      "The draft changed. Reload or compare the current revision before saving.",
    ),
    currentDraft: reportingStageDraftSchema,
  })
  .strict();

export const reportingStageDraftParamsSchema = z
  .object({ obligationId: z.uuid(), stageId: z.uuid() })
  .strict();

export const createReportingStageDraftInputSchema = z
  .object({ releaseId: z.uuid(), idempotencyKey: idempotencyKeySchema })
  .strict();

export const acquireReportingStageDraftLockInputSchema = z
  .object({
    expectedRevision: expectedRevisionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

/** Returned only to the lock holder; never embed this secret in a draft detail response. */
export const acquireReportingStageDraftLockResponseSchema = z
  .object({ draft: reportingStageDraftSchema, lockToken: z.uuid() })
  .strict();

const updateDraftFieldsSchema = z
  .array(reportingStageDraftFieldSchema)
  .max(100);
const updateMemberStatesSchema = z
  .array(reportingStageMemberStateSchema)
  .max(27);

export const saveReportingStageDraftInputSchema = z
  .object({
    expectedRevision: expectedRevisionSchema,
    lockToken: z.uuid(),
    fields: updateDraftFieldsSchema,
    memberStates: updateMemberStatesSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const submitReportingStageDraftInputSchema = z
  .object({
    expectedRevision: expectedRevisionSchema,
    lockToken: z.uuid(),
    submissionReference: requiredText(1_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reportingFamilyTemplateVersionSchema = z
  .object({
    id: z.uuid(),
    version: revisionSchema,
    fields: z.array(reportingStageDraftFieldSchema).max(100),
    createdBy: reportingActorSnapshotSchema,
    createdAt: utcSecondDateTimeSchema,
  })
  .strict()
  .superRefine((version, context) => {
    for (const [index, field] of version.fields.entries()) {
      if (field.value.type === "member_states") {
        context.addIssue({
          code: "custom",
          path: ["fields", index],
          message: "Family templates cannot carry release-scoped Member States",
        });
      }
    }
  });

export const reportingFamilyTemplateSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    obligationType: z.enum([
      "actively_exploited_vulnerability",
      "severe_incident",
    ]),
    stage: reportingObligationStageKindSchema,
    name: requiredText(200),
    description: z.string().trim().max(2_000).nullable(),
    currentVersion: reportingFamilyTemplateVersionSchema,
    createdBy: reportingActorSnapshotSchema,
    createdAt: utcSecondDateTimeSchema,
    archivedAt: utcSecondDateTimeSchema.nullable(),
  })
  .strict();

const familyTemplateFieldsSchema = z
  .array(reportingStageDraftFieldSchema)
  .max(100)
  .superRefine((fields, context) => {
    const keys = new Set<string>();
    for (const [index, field] of fields.entries()) {
      if (keys.has(field.value.key)) {
        context.addIssue({
          code: "custom",
          path: [index, "value", "key"],
          message: "Family template field keys must be unique",
        });
      }
      keys.add(field.value.key);
      if (field.value.type === "member_states") {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Family templates cannot carry release-scoped Member States",
        });
      }
    }
  });

export const createReportingFamilyTemplateInputSchema = z
  .object({
    obligationType: z.enum([
      "actively_exploited_vulnerability",
      "severe_incident",
    ]),
    stage: reportingObligationStageKindSchema,
    name: requiredText(200),
    description: z.string().trim().max(2_000).nullable().optional(),
    fields: familyTemplateFieldsSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const createReportingFamilyTemplateVersionInputSchema = z
  .object({
    expectedVersion: expectedRevisionSchema,
    fields: familyTemplateFieldsSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reportingFamilyTemplateParamsSchema = z
  .object({ templateId: z.uuid() })
  .strict();

export const reportingFamilyTemplateListQuerySchema = z
  .object({
    obligationType: z
      .enum(["actively_exploited_vulnerability", "severe_incident"])
      .optional(),
    stage: reportingObligationStageKindSchema.optional(),
  })
  .strict();

export const applyReportingFamilyTemplateInputSchema = z
  .object({
    templateVersionId: z.uuid(),
    expectedRevision: expectedRevisionSchema,
    lockToken: z.uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reportingStageDraftResponseSchema = z
  .object({ draft: reportingStageDraftSchema })
  .strict();
export const reportingStageDraftMutationResponseSchema =
  reportingStageDraftResponseSchema;
export const reportingStageSubmissionSnapshotResponseSchema = z
  .object({ submission: reportingStageSubmissionSnapshotSchema })
  .strict();
export const reportingStageDraftConflictResponseSchema = z
  .object({ conflict: reportingStageDraftConflictSchema })
  .strict();
export const reportingFamilyTemplateResponseSchema = z
  .object({ template: reportingFamilyTemplateSchema })
  .strict();
export const reportingFamilyTemplatesResponseSchema = z
  .object({ templates: z.array(reportingFamilyTemplateSchema).max(100) })
  .strict();
