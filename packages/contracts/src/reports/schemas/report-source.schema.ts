import { z } from "zod";
import { dashboardTrendsQuerySchema } from "../../dashboard/schemas/trends.schema.js";
import {
  createReadinessExportSchema,
  exportReadinessReportSchema,
  exportSources,
} from "../../exports/schemas/index.js";

export const REPORT_SCHEMA_VERSION = "m14_04_v1" as const;
export const REPORT_LIMITS = Object.freeze({
  maxRecipients: 20,
  maxActiveDefinitions: 100,
  availabilitySeconds: 86_400,
  downloadGrantSeconds: 300,
});
/** Temporary transport/capture state is never part of a durable definition. */
export const reportTransientFields = Object.freeze([
  "cursor",
  "page",
  "pageSize",
  "offset",
  "limit",
  "snapshotToken",
  "datasetToken",
  "sessionToken",
  "accessToken",
  "refreshToken",
]);
const filterTransientFields = [...reportTransientFields, "requestId"];
const omitTransient = (
  value: Record<string, unknown>,
  fields: readonly string[] = reportTransientFields,
) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !fields.includes(key)),
  );
const hasTransient = (
  value: Record<string, unknown>,
  fields: readonly string[] = reportTransientFields,
) => Object.keys(value).some((key) => fields.includes(key));
function nativeObject(schema: unknown): z.ZodObject | undefined {
  if (schema instanceof z.ZodObject) return schema;
  if (schema instanceof z.ZodPipe)
    return nativeObject(schema.in) ?? nativeObject(schema.out);
  return undefined;
}
const record = z.record(z.string(), z.unknown());

type MemberSourceId = {
  [
    S in keyof typeof exportSources
  ]: (typeof exportSources)[S]["subjectKind"] extends "member" ? S : never;
}[keyof typeof exportSources];
export const reportSources = Object.freeze(
  Object.fromEntries(
    Object.entries(exportSources).filter(
      ([, spec]) => spec.subjectKind === "member",
    ),
  ),
) as Readonly<Pick<typeof exportSources, MemberSourceId>>;
export const reportSourceIdSchema = z.enum(
  Object.keys(reportSources) as [MemberSourceId, ...MemberSourceId[]],
);

function sourceSchemas(source: keyof typeof exportSources) {
  const spec = exportSources[source];
  if (spec.subjectKind !== "member")
    throw new Error("Unsupported scheduled report source");
  const context =
    source === "audit.events" ? z.object({}).strict() : spec.contextSchema;
  const query =
    source === "dashboard.trends"
      ? dashboardTrendsQuerySchema
      : spec.querySchema;
  return { spec, context, query };
}

export const reportListSelectionSchema = z
  .object({
    kind: z.literal("list"),
    source: reportSourceIdSchema,
    format: z.enum(["csv", "xlsx"]),
    context: record,
    filters: record,
    columns: z.array(z.string().min(1).max(120)).min(1).max(100).optional(),
  })
  .strict()
  .transform((input, ctx) => {
    const { spec, context, query } = sourceSchemas(input.source);
    if (
      hasTransient(input.context) ||
      hasTransient(input.filters, filterTransientFields)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Temporary transport state cannot be saved",
      });
      return z.NEVER;
    }
    for (const [key, schema, value] of [
      ["context", context, input.context],
      ["filters", query, input.filters],
    ] as const) {
      const object = nativeObject(schema);
      if (!object)
        throw new Error(
          "Scheduled sources require an explicit object contract",
        );
      const unknown = Object.keys(value).filter(
        (field) => !Object.hasOwn(object.shape, field),
      );
      if (unknown.length)
        ctx.addIssue({ code: "unrecognized_keys", keys: unknown, path: [key] });
    }
    const parsedContext = context.safeParse(input.context);
    const nativeFilters =
      input.source === "connectors.siem_destinations" ||
      input.source === "connectors.siem_deliveries"
        ? {
            ...input.filters,
            requestId: "00000000-0000-4000-8000-000000000001",
          }
        : input.filters;
    const parsedFilters = query.safeParse(nativeFilters);
    for (const [key, parsed] of [
      ["context", parsedContext],
      ["filters", parsedFilters],
    ] as const) {
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          ctx.addIssue({ ...issue, path: [key, ...issue.path] });
    }
    if (
      input.columns &&
      (new Set(input.columns).size !== input.columns.length ||
        input.columns.some(
          (key) => !spec.columns.some((column) => column.key === key),
        ))
    )
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Choose unique approved columns",
      });
    if (!parsedContext.success || !parsedFilters.success) return z.NEVER;
    return {
      ...input,
      context: parsedContext.data as Record<string, unknown>,
      filters: omitTransient(
        parsedFilters.data as Record<string, unknown>,
        filterTransientFields,
      ),
    };
  });
export const reportReadinessSelectionSchema = z
  .object({ kind: z.literal("readiness"), productId: z.uuid() })
  .strict();
export const reportSelectionSchema = z.union([
  reportListSelectionSchema,
  reportReadinessSelectionSchema,
]);

/** Accepts a scheduling selection or an interactive export request, without mutating either. */
export function normalizeReportSelection(
  input: unknown,
): z.output<typeof reportSelectionSchema> {
  const raw = record.parse(input);
  if (raw.kind === "readiness")
    return reportReadinessSelectionSchema.parse(raw);
  const source = reportSourceIdSchema.parse(raw.source);
  const context = omitTransient(record.parse(raw.context ?? {}));
  const filters = omitTransient(
    record.parse(raw.filters ?? {}),
    filterTransientFields,
  );
  const candidate = {
    kind: "list" as const,
    source,
    format: raw.format,
    context,
    filters,
    ...(raw.columns === undefined ? {} : { columns: raw.columns }),
  };
  return reportListSelectionSchema.parse(candidate);
}

/** The native input contracts and approved projection travel with a definition digest. */
export function reportSourceSchemaDescriptor(source: string) {
  if (source === "technical_files.readiness_report")
    return {
      schemaVersion: REPORT_SCHEMA_VERSION,
      source,
      scope: "all_filtered" as const,
      context: z.toJSONSchema(createReadinessExportSchema, {
        io: "input",
        unrepresentable: "any",
      }),
      output: z.toJSONSchema(exportReadinessReportSchema, {
        io: "output",
        unrepresentable: "any",
      }),
      requiredPermissions: [
        "can_view_technical_files",
        "can_export_technical_files",
      ],
      excludedFields: ["idempotencyKey"],
      dateContract: null,
    };
  const id = reportSourceIdSchema.parse(source);
  const { spec, context, query } = sourceSchemas(id);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    source: id,
    scope: "all_filtered" as const,
    context: z.toJSONSchema(context, { io: "input", unrepresentable: "any" }),
    filters: z.toJSONSchema(query, { io: "input", unrepresentable: "any" }),
    parsedFilters: z.toJSONSchema(query, {
      io: "output",
      unrepresentable: "any",
    }),
    nativeFilters: z.toJSONSchema(nativeObject(query)!, {
      io: "input",
      unrepresentable: "any",
    }),
    excludedFields: {
      context: reportTransientFields,
      filters: filterTransientFields,
    },
    columns: spec.columns,
    requiredPermissions: spec.requiredPermissions,
    requiredRole: spec.requiredRole ?? null,
    dateContract:
      id === "audit.events"
        ? "instant_half_open"
        : id === "dashboard.trends"
          ? "calendar_inclusive"
          : null,
  };
}
