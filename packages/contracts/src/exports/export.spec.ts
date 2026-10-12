import { describe, expect, it } from "vitest";
import {
  createExportJobSchema,
  exportJobSchema,
  EXPORT_LIMITS,
  exportSources,
} from "./index.js";
import { defaultPermissionsFor } from "../permissions.js";
import {
  dashboardTrendBucketSchema,
  dashboardTrendsQuerySchema,
} from "../dashboard/schemas/trends.schema.js";
import { retentionPolicySchema } from "../organizations/schemas/organization-retention.schema.js";
const key = "e8a43815-631a-4363-9744-4dd067f49ab1";
describe("M14 export boundary", () => {
  it("keeps the discriminated request boundary complete and removes unrendered API aliases", () => {
    const requestSources = createExportJobSchema.options.map(
      (option) => option.shape.source.value,
    );
    expect(requestSources.sort()).toEqual(Object.keys(exportSources).sort());
    for (const source of [
      "connectors.identities",
      "connectors.dead_letters",
      "risk_register.requirements",
      "frameworks.upgrade_review",
      "audit.detail_chain",
      "technical_file.source_review_history",
    ]) {
      expect(
        createExportJobSchema.safeParse({
          source,
          context: {},
          filters: {},
          format: "csv",
          idempotencyKey: key,
        }).success,
      ).toBe(false);
    }
  });
  it("requires source-owned audit high-water identity and exact selected snapshot-export identity", () => {
    const audit = {
      source: "audit.events",
      context: { snapshotToken: "opaque_snapshot" },
      filters: { from: "2026-10-01T00:00:00Z", to: "2026-10-09T00:00:00Z" },
      format: "csv",
      idempotencyKey: key,
    };
    expect(createExportJobSchema.parse(audit).context).toEqual(audit.context);
    expect(
      createExportJobSchema.safeParse({ ...audit, context: {} }).success,
    ).toBe(false);
    const snapshotExport = {
      source: "technical_file.snapshot_exports",
      context: { productId: key, snapshotId: key, exportId: key },
      filters: {},
      format: "csv",
      idempotencyKey: key,
    };
    expect(createExportJobSchema.parse(snapshotExport).context).toEqual(
      snapshotExport.context,
    );
    expect(
      createExportJobSchema.safeParse({
        ...snapshotExport,
        context: { productId: key, snapshotId: key },
      }).success,
    ).toBe(false);
  });
  it("shares product filters, rejects unknown source/context/columns", () => {
    const input = {
      source: "products.registry",
      context: {},
      filters: { q: "  device  " },
      format: "csv",
      idempotencyKey: key,
    };
    const parsed = createExportJobSchema.parse(input);
    expect(parsed.scope).toBe("all_filtered");
    expect(parsed.filters).toMatchObject({ q: "device", page: 1 });
    for (const extra of [
      { source: "unknown" },
      { context: { orgId: key } },
      { columns: ["secret"] },
      { filters: { password: "x" } },
    ])
      expect(
        createExportJobSchema.safeParse({ ...input, ...extra }).success,
      ).toBe(false);
  });
  it("requires selected ids and rejects selection on unsupported lists", () => {
    const input = {
      source: "products.registry",
      context: {},
      filters: {},
      format: "xlsx",
      idempotencyKey: key,
      scope: "selected",
    };
    expect(createExportJobSchema.safeParse(input).success).toBe(false);
    expect(
      createExportJobSchema.safeParse({ ...input, selectedIds: [key] }).success,
    ).toBe(false);
    expect(
      createExportJobSchema.safeParse({
        ...input,
        source: "findings.triage_queue",
        selectedIds: [key],
      }).success,
    ).toBe(true);
  });
  it("bounds jobs and refuses unknown success fields", () => {
    expect(EXPORT_LIMITS.maxRows).toBe(100_000);
    expect(
      exportJobSchema.safeParse({ id: key, token: "secret" }).success,
    ).toBe(false);
    expect(EXPORT_LIMITS.maxArtifactBytes).toBe(64 * 1024 * 1024);
  });
  it("keeps export capabilities owner/admin by default without weakening existing grants", () => {
    for (const module of [
      "roles",
      "invitations",
      "reporting",
      "technical_files",
      "sboms",
      "evidence",
      "suppliers",
      "frameworks",
      "tasks",
      "notifications",
      "vulnerabilities",
    ]) {
      const permission = `can_export_${module}` as keyof ReturnType<
        typeof defaultPermissionsFor
      >;
      expect(defaultPermissionsFor("owner")[permission]).toBe(true);
      expect(defaultPermissionsFor("admin")[permission]).toBe(true);
      expect(defaultPermissionsFor("member")[permission]).not.toBe(true);
      expect(defaultPermissionsFor("viewer")[permission]).not.toBe(true);
    }
    expect(defaultPermissionsFor("member").can_export_products).toBe(true);
  });
  it("declares approved columns and authoritative source permissions", () => {
    for (const source of Object.values(exportSources)) {
      expect(source.columns.length).toBeGreaterThan(0);
      expect(new Set(source.columns.map((column) => column.key)).size).toBe(
        source.columns.length,
      );
      expect(source.requiredPermissions).not.toContain("can_export_tables");
    }
  });
});

describe("source boundary compatibility", () => {
  it("preserves every native trend bucket value including activity counts and partial observations", () => {
    const columns = exportSources["dashboard.trends"].columns;
    for (const field of Object.keys(dashboardTrendBucketSchema.shape)) {
      expect(columns.map((column) => column.key)).toContain(field);
    }
    for (const key of [
      "opened",
      "closed",
      "reopened",
      "sampleCount",
      "excludedCount",
      "numerator",
      "denominator",
      "sourceCount",
    ]) {
      expect(columns.find((column) => column.key === key)?.type).toBe("number");
    }
    expect(columns.find((column) => column.key === "partial")?.type).toBe(
      "boolean",
    );
    expect(columns.find((column) => column.key === "start")?.type).toBe(
      "datetime",
    );
    expect(columns.find((column) => column.key === "end")?.type).toBe(
      "datetime",
    );
  });
  it("limits organization retention exports to public native contract fields", () => {
    const nativeKeys = Object.keys(retentionPolicySchema.shape);
    for (const column of exportSources["organization.retention_policies"]
      .columns) {
      expect(nativeKeys).toContain(column.key);
    }
    expect(
      createExportJobSchema.safeParse({
        source: "organization.retention_policies",
        context: {},
        filters: {},
        columns: ["floorSnapshotVersion"],
        format: "csv",
        idempotencyKey: key,
      }).success,
    ).toBe(false);
  });
  it("requires the displayed pinned dataset for trend exports while preserving unpinned reads", () => {
    const filters = { from: "2026-10-01", to: "2026-10-08" };
    const request = {
      source: "dashboard.trends",
      context: {},
      filters,
      format: "csv",
      idempotencyKey: key,
    };
    expect(dashboardTrendsQuerySchema.safeParse(filters).success).toBe(true);
    expect(createExportJobSchema.safeParse(request).success).toBe(false);
    const pinned = {
      ...request,
      filters: { ...filters, datasetToken: "signed_pinned_dataset" },
    };
    expect(createExportJobSchema.parse(pinned).filters).toMatchObject(
      pinned.filters,
    );
    expect(
      createExportJobSchema.safeParse({
        ...pinned,
        filters: { ...filters, datasetToken: "" },
      }).success,
    ).toBe(false);
  });
  it("exports the native bulk-intake status without an invented state alias", () => {
    expect(
      exportSources["evidence.bulk_intake_batch"].columns.map(
        (column) => column.key,
      ),
    ).toContain("status");
    expect(
      exportSources["evidence.bulk_intake_batch"].columns.map(
        (column) => column.key,
      ),
    ).not.toContain("state");
  });
  it("names modification history context after the native modification identity", () => {
    const input = {
      source: "products.compliance.mod_assessment_history",
      context: { productId: key, modificationId: key },
      filters: {},
      format: "csv",
      idempotencyKey: key,
    };
    expect(createExportJobSchema.parse(input).context).toEqual(input.context);
    expect(
      createExportJobSchema.safeParse({
        ...input,
        context: { productId: key, assessmentId: key },
      }).success,
    ).toBe(false);
  });
  it("preserves product-wide support scope with an optional release filter only on history", () => {
    const history = {
      source: "products.support_period_history",
      context: { productId: key },
      filters: {},
      format: "csv",
      idempotencyKey: key,
    };
    expect(createExportJobSchema.parse(history).context).toEqual({
      productId: key,
    });
    expect(
      createExportJobSchema.parse({ ...history, filters: { releaseId: key } })
        .filters,
    ).toEqual({ releaseId: key });
    const alerts = { ...history, source: "products.support_alerts" };
    expect(createExportJobSchema.parse(alerts).context).toEqual({
      productId: key,
    });
    expect(
      createExportJobSchema.safeParse({
        ...alerts,
        filters: { releaseId: key },
      }).success,
    ).toBe(false);
    expect(
      createExportJobSchema.safeParse({
        ...history,
        context: { productId: key, releaseId: key },
      }).success,
    ).toBe(false);
  });
  it("exports native assessment evidence link fields and refuses invented aliases", () => {
    const input = {
      source: "findings.detail.assessment_evidence",
      context: { findingId: key },
      filters: {},
      format: "csv",
      idempotencyKey: key,
      columns: ["id", "kind", "title", "url", "evidenceId"],
    };
    expect(createExportJobSchema.parse(input).columns).toEqual(input.columns);
    for (const field of ["recordId", "revision", "reference"])
      expect(
        createExportJobSchema.safeParse({ ...input, columns: [field] }).success,
      ).toBe(false);
  });
  it("is idempotent across client serialization and server parsing", () => {
    for (const [source, context, filters] of [
      ["products.registry", {}, { archived: "true" }],
      ["products.releases", { productId: key }, { archived: "false" }],
      [
        "products.relationship.graph_links",
        { productId: key },
        { includeEnded: "true" },
      ],
      ["suppliers.registry", {}, { includeArchived: "false" }],
      ["frameworks.controls", {}, { includeArchived: "true" }],
      ["findings.triage_queue", {}, { openOnly: "true" }],
    ] as const) {
      const parsed = createExportJobSchema.parse({
        source,
        context,
        filters,
        format: "csv",
        idempotencyKey: key,
      });
      expect(
        createExportJobSchema.parse(JSON.parse(JSON.stringify(parsed))),
      ).toEqual(parsed);
    }
  });
  it("preserves historical source guards and limits portable sensitive finding rows", () => {
    expect(
      exportSources["reporting.obligations"].requiredPermissions,
    ).toContain("can_view_findings");
    for (const source of [
      "sboms.ci_credentials",
      "sboms.ci_bindings",
      "sboms.ci_binding_runs",
    ] as const)
      expect(exportSources[source].requiredRole).toBe("owner");
    expect(exportSources["vulnerabilities.feed_health"].requiredRole).toBe(
      "admin",
    );
    expect(
      exportSources["notifications.deliveries"].requiredPermissions,
    ).toContain("can_view_audit");
    expect(
      exportSources["vulnerabilities.document_findings"].requiredPermissions,
    ).toContain("can_export_findings");
    expect(exportSources["sboms.diff_findings"].requiredPermissions).toContain(
      "can_view_findings",
    );
  });
  it("uses scoped portal subjects without member grants", () => {
    for (const source of [
      "supplier_evidence.portal_items",
      "supplier_evidence.portal_submissions",
    ] as const) {
      expect(exportSources[source].subjectKind).toBe("supplier_session");
      expect(exportSources[source].requiredPermissions).toEqual([]);
    }
    expect(
      exportSources["technical_file.auditor_manifest_artifacts"].subjectKind,
    ).toBe("auditor_session");
    expect(
      createExportJobSchema.safeParse({
        source: "supplier_evidence.portal_items",
        context: { requestId: key, sessionToken: "secret" },
        filters: {},
        format: "csv",
        idempotencyKey: key,
      }).success,
    ).toBe(false);
  });
  it("uses typed cells without turning identifiers into numbers", () => {
    const columns = exportSources["notifications.burst_batches"].columns;
    expect(columns.find((column) => column.key === "createdAt")?.type).toBe(
      "datetime",
    );
    expect(columns.find((column) => column.key === "memberCount")?.type).toBe(
      "number",
    );
    expect(
      exportSources["organization.holidays"].columns.find(
        (column) => column.key === "date",
      )?.type,
    ).toBe("date");
    expect(
      exportSources["users.members"].columns.find(
        (column) => column.key === "isActive",
      )?.type,
    ).toBe("boolean");
    expect(
      exportSources["audit.events"].columns.find(
        (column) => column.key === "sequence",
      )?.type,
    ).toBe("text");
  });
  it("rejects duplicated selections/columns, unrelated selections and unsupported pages", () => {
    const input = {
      source: "findings.triage_queue",
      context: {},
      filters: {},
      format: "csv",
      idempotencyKey: key,
    };
    for (const overrides of [
      { scope: "selected", selectedIds: [key, key] },
      { selectedIds: [key] },
      { columns: ["id", "id"] },
    ])
      expect(
        createExportJobSchema.safeParse({ ...input, ...overrides }).success,
      ).toBe(false);
    expect(
      createExportJobSchema.parse({
        ...input,
        scope: "selected",
        selectedIds: [key],
        columns: ["id"],
      }).columns,
    ).toEqual(["id"]);
    expect(
      createExportJobSchema.parse({ ...input, scope: "current_page" }).scope,
    ).toBe("current_page");
    expect(
      createExportJobSchema.safeParse({
        ...input,
        source: "roles.custom_roles",
        scope: "current_page",
      }).success,
    ).toBe(false);
  });
});
