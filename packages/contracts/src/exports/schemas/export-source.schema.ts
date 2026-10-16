import { z } from "zod";
import { EXPORT_LIMITS } from "./export-source-base.schema.js";
export {
  EXPORT_LIMITS,
  exportColumnTypeSchema,
  exportColumnSchema,
  textColumns,
} from "./export-source-base.schema.js";
import { productsExportSources } from "./products-export-sources.schema.js";
import { evidenceExportSources } from "./evidence-export-sources.schema.js";
import { suppliersExportSources } from "./suppliers-export-sources.schema.js";
import { workspaceExportSources } from "./workspace-export-sources.schema.js";
import { vulnerabilitiesExportSources } from "./vulnerabilities-export-sources.schema.js";
import { sbomsExportSources } from "./sboms-export-sources.schema.js";
import { notificationsExportSources } from "./notifications-export-sources.schema.js";
import { technical_filesExportSources } from "./technical-files-export-sources.schema.js";
import { connectorsExportSources } from "./connectors-export-sources.schema.js";
import { frameworksExportSources } from "./frameworks-export-sources.schema.js";
export const exportSources = {
  ...productsExportSources,
  ...evidenceExportSources,
  ...suppliersExportSources,
  ...workspaceExportSources,
  ...vulnerabilitiesExportSources,
  ...sbomsExportSources,
  ...notificationsExportSources,
  ...technical_filesExportSources,
  ...connectorsExportSources,
  ...frameworksExportSources,
} as const;
export const exportSourceIdSchema = z.enum(
  Object.keys(exportSources) as [
    keyof typeof exportSources,
    ...(keyof typeof exportSources)[],
  ],
);
export const exportScopeSchema = z.enum([
  "all_filtered",
  "current_page",
  "selected",
]);
const common = {
  format: z.enum(["csv", "xlsx"]),
  scope: exportScopeSchema.default("all_filtered"),
  selectedIds: z.array(z.uuid()).min(1).max(EXPORT_LIMITS.maxRows).optional(),
  columns: z.array(z.string()).min(1).max(100).optional(),
  idempotencyKey: z.uuid(),
};
function request<S extends keyof typeof exportSources>(source: S) {
  const spec = exportSources[source];
  return z
    .object({
      ...common,
      source: z.literal(source),
      context: spec.contextSchema as (typeof exportSources)[S]["contextSchema"],
      filters: spec.querySchema as (typeof exportSources)[S]["querySchema"],
    })
    .strict();
}
export const createExportJobSchema = z
  .discriminatedUnion("source", [
    request("products.registry"),
    request("products.releases"),
    request("evidence.documents"),
    request("suppliers.registry"),
    request("tasks.inbox"),
    request("findings.triage_queue"),
    request("audit.events"),
    request("dashboard.trends"),
    request("users.members"),
    request("roles.custom_roles"),
    request("invitations.pending"),
    request("sboms.source_history"),
    request("sboms.documents_for_release"),
    request("sboms.components"),
    request("sboms.dependency_tree"),
    request("sboms.quality_findings"),
    request("sboms.validation_diagnostics"),
    request("sboms.diff_components"),
    request("sboms.diff_findings"),
    request("sboms.composite_conflicts"),
    request("sboms.composite_relationships"),
    request("sboms.supplier_requests"),
    request("sboms.ci_credentials"),
    request("sboms.ci_bindings"),
    request("sboms.ci_binding_runs"),
    request("vulnerabilities.document_findings"),
    request("vulnerabilities.enriched_findings"),
    request("vulnerabilities.reevaluation_history"),
    request("vulnerabilities.reachability_evidence"),
    request("vulnerabilities.sync_runs"),
    request("vulnerabilities.feed_health"),
    request("evidence.search_results"),
    request("evidence.versions"),
    request("reporting.obligations"),
    request("notifications.feed"),
    request("notifications.feed_preview_items"),
    request("notifications.deliveries"),
    request("notifications.burst_batches"),
    request("products.imports"),
    request("products.import_rows"),
    request("products.support_period_history"),
    request("products.support_alerts"),
    request("products.relationship.baseline_memberships"),
    request("products.relationship.baseline_revisions"),
    request("products.relationship.variants"),
    request("products.relationship.component_links"),
    request("products.relationship.graph_links"),
    request("products.relationship.propagation_events"),
    request("products.compliance.mod_assessments"),
    request("products.compliance.mod_assessment_history"),
    request("products.compliance.security_artifacts"),
    request("evidence.legal_holds"),
    request("evidence.retention_review"),
    request("evidence.bulk_intake_batch"),
    request("suppliers.contacts"),
    request("suppliers.responsibilities"),
    request("supplier_evidence.requests"),
    request("supplier_evidence.overdue"),
    request("supplier_evidence.review_items"),
    request("supplier_evidence.review_submissions"),
    request("supplier_evidence.review_history"),
    request("supplier_evidence.extraction_fields"),
    request("technical_file.sections"),
    request("technical_file.section_sources"),
    request("technical_file.readiness_gaps"),
    request("technical_file.snapshots"),
    request("technical_file.snapshot_exports"),
    request("technical_file.declarations"),
    request("technical_file.auditor_grants"),
    request("risk_register.risks"),
    request("reporting.stage_evidence_timeline"),
    request("findings.saved_views"),
    request("findings.detail.assessment_history"),
    request("findings.detail.assessment_evidence"),
    request("findings.detail.approval_policy"),
    request("findings.bulk_assessment_targets"),
    request("findings.remediation_history"),
    request("findings.remediation_tickets"),
    request("findings.notes"),
    request("findings.vex_exports"),
    request("findings.vex_publications"),
    request("findings.vex_publication_targets"),
    request("findings.responsible_suppliers"),
    request("tasks.routing_groups"),
    request("tasks.absences"),
    request("supplier_evidence.portal_items"),
    request("supplier_evidence.portal_submissions"),
    request("technical_file.auditor_manifest_artifacts"),
    request("connectors.sync_runs"),
    request("connectors.sync_history"),
    request("connectors.sync_records"),
    request("connectors.sync_plan_items"),
    request("connectors.dead_letter_records"),
    request("connectors.run_conflicts"),
    request("connectors.sync_run_attempts"),
    request("connectors.agent_batches"),
    request("connectors.webhook_endpoints"),
    request("connectors.webhook_deliveries"),
    request("connectors.webhook_attempts"),
    request("connectors.siem_destinations"),
    request("connectors.siem_deliveries"),
    request("connectors.catalogue"),
    request("connectors.overview"),
    request("frameworks.catalog"),
    request("frameworks.requirement_tree"),
    request("frameworks.controls"),
    request("frameworks.crosswalks"),
    request("frameworks.upgrade_preview"),
    request("frameworks.custom"),
    request("frameworks.custom_requirements_preview"),
    request("notifications.chat_channels"),
    request("notifications.chat_deliveries"),
    request("organization.legal_entities"),
    request("organization.retention_policies"),
    request("organization.tenant_exports"),
    request("organization.holidays"),
    request("organization.lifecycle_blockers"),
    request("onboarding.progress"),
    request("permissions.matrix"),
    request("frameworks.coverage_requirements"),
  ])
  .superRefine((value, context) => {
    const spec = exportSources[value.source];
    if (
      value.scope === "selected" &&
      (!spec.supportsSelection ||
        !value.selectedIds ||
        new Set(value.selectedIds).size !== value.selectedIds.length)
    )
      context.addIssue({
        code: "custom",
        path: ["selectedIds"],
        message:
          "This view does not support selection or selected IDs are missing/duplicated",
      });
    if (value.scope !== "selected" && value.selectedIds)
      context.addIssue({
        code: "custom",
        path: ["selectedIds"],
        message: "Selected IDs are only valid for selected scope",
      });
    if (value.scope === "current_page" && !spec.supportsPage)
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: "This view has no page export",
      });
    if (
      value.columns &&
      (new Set(value.columns).size !== value.columns.length ||
        value.columns.some(
          (key) => !spec.columns.some((column) => column.key === key),
        ))
    )
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Choose unique approved columns",
      });
  });
