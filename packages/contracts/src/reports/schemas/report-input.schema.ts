import { z } from "zod";
import {
  REPORT_LIMITS,
  reportSelectionSchema,
} from "./report-source.schema.js";
export const reportTimezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone");
export const reportScheduleSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    timezone: reportTimezoneSchema,
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    weekday: z.number().int().min(0).max(6).optional(),
    monthDay: z.number().int().min(1).max(31).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.frequency === "weekly") !== (value.weekday !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["weekday"],
        message: "Only weekly schedules require weekday (Sunday=0)",
      });
    if ((value.frequency === "monthly") !== (value.monthDay !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["monthDay"],
        message: "Only monthly schedules require monthDay",
      });
  });
export const reportDateWindowSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed") }).strict(),
  z
    .object({
      kind: z.literal("rolling"),
      days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    })
    .strict(),
]);
export const reportConfigurationSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    report: reportSelectionSchema,
    schedule: reportScheduleSchema,
    dateWindow: reportDateWindowSchema,
    recipientUserIds: z
      .array(z.uuid())
      .min(1)
      .max(REPORT_LIMITS.maxRecipients)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Recipients must be distinct",
      ),
    emailEnabled: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.dateWindow.kind === "rolling" &&
      (value.report.kind !== "list" ||
        !["audit.events", "dashboard.trends"].includes(value.report.source))
    )
      ctx.addIssue({
        code: "custom",
        path: ["dateWindow"],
        message: "Rolling dates require a supported source date contract",
      });
  });
const version = z.number().int().positive();
const command = { expectedVersion: version, idempotencyKey: z.uuid() };
export const createReportDefinitionSchema = z
  .object({ config: reportConfigurationSchema, idempotencyKey: z.uuid() })
  .strict();
export const updateReportDefinitionSchema = z
  .object({ config: reportConfigurationSchema, ...command })
  .strict();
export const reportMutationSchema = z
  .object({ ...command, previewRunId: z.uuid().optional() })
  .strict();
export const reportDefinitionParamsSchema = z
  .object({ definitionId: z.uuid() })
  .strict();
export const reportRunParamsSchema = z.object({ runId: z.uuid() }).strict();
export const reportRecipientParamsSchema = z
  .object({ runId: z.uuid(), recipientId: z.uuid() })
  .strict();
export const reportDownloadParamsSchema = reportRecipientParamsSchema
  .extend({ grantId: z.uuid() })
  .strict();
export const reportListQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export const reportRunsQuerySchema = reportListQuerySchema
  .extend({ definitionId: z.uuid().optional() })
  .strict();
export const reportGrantInputSchema = z
  .object({ artifactId: z.uuid() })
  .strict();
export const reportEmailPreferenceInputSchema = z
  .object({ mode: z.enum(["immediate", "off"]), ...command })
  .strict();
