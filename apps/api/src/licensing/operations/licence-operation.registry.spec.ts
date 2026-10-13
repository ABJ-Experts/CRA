import {
  getLicenceRouteOperation,
  getLicenceWorkerOperation,
} from "./licence-operation.registry";

describe("explicit licence operation registry", () => {
  it("does not derive POST allowance or GET exemptions from HTTP verbs", () => {
    expect(
      getLicenceRouteOperation("ProductsController", "create"),
    ).toMatchObject({
      kind: "customer",
      capability: "products",
      mutation: true,
    });
    expect(getLicenceRouteOperation("ReportsController", "list")).toMatchObject(
      { kind: "customer", capability: "scheduled_reports", mutation: false },
    );
    expect(
      getLicenceRouteOperation("EvidenceController", "authorizeAccess"),
    ).toMatchObject({ kind: "evidence", mutation: true });
    expect(
      getLicenceRouteOperation("ReportingObligationController", "create"),
    ).toMatchObject({ kind: "customer", capability: "reporting" });
    expect(
      getLicenceRouteOperation(
        "ReportingObligationController",
        "submitStageDraft",
      ),
    ).toMatchObject({ kind: "regulatory", capability: "reporting" });
  });
  it("keeps renewal, identity and retained evidence accessible", () => {
    expect(
      getLicenceRouteOperation("LicensingController", "activate")?.kind,
    ).toBe("renewal");
    expect(
      getLicenceRouteOperation("AuthController", "refreshJson")?.kind,
    ).toBe("security");
    expect(
      getLicenceRouteOperation("OrganizationsController", "switch")?.kind,
    ).toBe("security");
    expect(
      getLicenceRouteOperation(
        "TenantAdministrationController",
        "requestExport",
      )?.kind,
    ).toBe("evidence");
    expect(
      getLicenceRouteOperation(
        "TechnicalFilesController",
        "createSnapshotExport",
      )?.kind,
    ).toBe("evidence");
    expect(getLicenceRouteOperation("ReportsController", "grant")?.kind).toBe(
      "evidence",
    );
  });
  it("classifies retained reads separately from side-effecting previews and generators", () => {
    for (const [controller, handler, capability] of [
      ["ProductsController", "get", "products"],
      ["ProductsController", "listReleases", "products"],
      ["SbomJobsController", "job", "sboms"],
      ["VulnerabilityTriageController", "queue", "findings"],
      ["VulnerabilityVexExportController", "preview", "findings"],
      ["DashboardController", "readiness", "dashboards"],
    ] as const)
      expect(getLicenceRouteOperation(controller, handler)).toMatchObject({
        kind: "customer",
        capability,
        mutation: false,
      });

    for (const [controller, handler, capability] of [
      ["ProductsController", "previewSupportPeriodChange", "products"],
      ["ConnectorsSyncOperationsController", "previewMapping", "connectors"],
      [
        "VulnerabilityAssessmentBulkController",
        "createBulkPreview",
        "findings",
      ],
      ["SbomCompositeReviewsController", "generate", "sboms"],
      ["ReportsController", "preview", "scheduled_reports"],
    ] as const)
      expect(getLicenceRouteOperation(controller, handler)).toMatchObject({
        kind: "customer",
        capability,
        mutation: true,
      });
  });

  it("requires verified source scope and keeps mixed intent separate", () => {
    expect(
      getLicenceRouteOperation("SupplierEvidencePortalController", "reserve"),
    ).toMatchObject({
      kind: "source",
      identity: "source",
      capability: "suppliers",
    });
    expect(
      getLicenceRouteOperation("EvidenceController", "complete")?.kind,
    ).toBe("admission-finalization");
    expect(
      getLicenceRouteOperation("UsersController", "setActive"),
    ).toMatchObject({ kind: "mixed", capability: "administration" });
  });
  it("gates scheduled processing while preserving export and protective timers", () => {
    expect(
      getLicenceWorkerOperation(
        "apps/api/src/reports/worker/reports-worker.ts",
      ),
    ).toMatchObject({ kind: "customer", capability: "scheduled_reports" });
    expect(
      getLicenceWorkerOperation("apps/api/src/exports/worker/export-worker.ts")
        ?.kind,
    ).toBe("evidence");
    expect(
      getLicenceWorkerOperation(
        "apps/api/src/reporting/worker/reporting-deadline-monitor-worker.ts",
      )?.kind,
    ).toBe("protective");
    expect(
      getLicenceWorkerOperation(
        "apps/api/src/audit/range/audit-range-worker.ts",
      )?.kind,
    ).toBe("security");
  });
  it("requires connector entitlement for SIEM configuration and elective replay", () => {
    for (const method of [
      "create",
      "update",
      "enable",
      "rotate_credentials",
      "test",
      "replay",
      "replay_preview",
    ])
      expect(getLicenceRouteOperation("SiemController", method)).toMatchObject({
        kind: "customer",
        capability: "connectors",
      });
    for (const method of [
      "disable",
      "revoke_credentials",
      "deliveries",
      "delivery",
      "list",
      "get",
    ])
      expect(getLicenceRouteOperation("SiemController", method)?.kind).toBe(
        "security",
      );
  });
  it("unknown and prototype names are absent grants", () => {
    expect(
      getLicenceRouteOperation("UnknownController", "create"),
    ).toBeUndefined();
    expect(
      getLicenceRouteOperation("__proto__", "constructor"),
    ).toBeUndefined();
    expect(getLicenceWorkerOperation("__proto__")).toBeUndefined();
  });
});
