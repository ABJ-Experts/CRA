import { z } from "zod";
import { taskListQuerySchema } from "../../tasks/schemas/task.schema.js";
import {
  auditSearchFiltersSchema,
  auditSnapshotParamsSchema,
} from "../../audit/schemas/audit-explorer.schema.js";
import { dashboardTrendsQuerySchema } from "../../dashboard/schemas/trends.schema.js";
import { pageParamsSchema } from "../../pagination/schemas/pagination.schema.js";
import * as reporting from "../../reporting/schemas/index.js";
import { definition, textColumns, none } from "./export-source-base.schema.js";

export const workspaceExportSources = {
  "tasks.inbox": definition(
    taskListQuerySchema,
    none,
    textColumns(
      "sourceId",
      "taskType",
      "state",
      "title",
      "accountableOwnerUserId",
      "dueAt",
    ),
    ["can_export_tasks"],
  ),
  "audit.events": definition(
    auditSearchFiltersSchema,
    auditSnapshotParamsSchema,
    textColumns(
      "id",
      "sequence",
      "createdAt",
      "action",
      "resourceType",
      "resourceId",
    ),
    ["can_view_audit", "can_export_audit"],
  ),
  "dashboard.trends": definition(
    dashboardTrendsQuerySchema.safeExtend({
      datasetToken: dashboardTrendsQuerySchema.shape.datasetToken.unwrap(),
    }),
    none,
    textColumns(
      "bucket",
      "metric",
      "start",
      "end",
      "partial",
      "opened",
      "closed",
      "reopened",
      "value",
      "sampleCount",
      "excludedCount",
      "numerator",
      "denominator",
      "sourceCount",
      "sourceVersion",
      "asOf",
    ).map((column) => ({
      ...column,
      type:
        column.key === "start" ||
        column.key === "end" ||
        column.key === "bucket" ||
        column.key === "asOf"
          ? ("datetime" as const)
          : column.key === "partial"
            ? ("boolean" as const)
            : [
                  "opened",
                  "closed",
                  "reopened",
                  "sampleCount",
                  "excludedCount",
                  "numerator",
                  "denominator",
                  "sourceCount",
                ].includes(column.key)
              ? ("number" as const)
              : column.type,
    })),
    ["can_view_dashboards", "can_export_dashboards"],
  ),
  "users.members": definition(
    pageParamsSchema,
    none,
    textColumns(
      "id",
      "firstName",
      "lastName",
      "email",
      "role",
      "isActive",
      "joinedAt",
    ),
    ["can_view_users", "can_export_users"],
    true,
  ),
  "roles.custom_roles": definition(
    none,
    none,
    textColumns("id", "name", "baseRole", "isActive", "memberCount"),
    ["can_view_roles", "can_export_roles"],
  ),
  "invitations.pending": definition(
    none,
    none,
    textColumns("id", "email", "role", "status", "expiresAt"),
    ["can_view_invitations", "can_export_invitations"],
  ),
  "reporting.obligations": definition(
    reporting.reportingObligationListQuerySchema,
    none,
    textColumns("id", "type", "status", "awarenessAt", "createdAt"),
    ["can_view_findings", "can_export_reporting"],
  ),
  "reporting.stage_evidence_timeline": definition(
    none,
    z.object({ obligationId: z.uuid(), stageId: z.uuid() }).strict(),
    textColumns(
      "id",
      "kind",
      "occurredAt",
      "recordedAt",
      "summary",
      "contentSha256",
    ),
    ["can_view_reporting", "can_export_reporting"],
  ),
  "tasks.routing_groups": definition(
    none,
    none,
    textColumns("id", "name", "version", "createdAt", "updatedAt"),
    ["can_export_tasks"],
  ),
  "tasks.absences": definition(
    none,
    none,
    textColumns("id", "userId", "startsAt", "endsAt", "reason", "version"),
    ["can_export_tasks"],
  ),
  "organization.legal_entities": definition(
    none,
    none,
    textColumns(
      "id",
      "identifier",
      "displayName",
      "legalName",
      "mainEstablishmentCountry",
      "manufacturerContactName",
      "manufacturerContactEmail",
      "phone",
      "registrationIdentifier",
      "taxIdentifier",
      "completionStatus",
      "status",
      "isDefault",
      "version",
      "createdAt",
      "updatedAt",
    ),
    ["can_view_organization", "can_export_organization"],
  ),
  "organization.retention_policies": definition(
    none,
    none,
    textColumns(
      "id",
      "evidenceClass",
      "version",
      "requestedRetentionDays",
      "effectiveFloorDays",
      "effectiveRetentionDays",
      "updatedAt",
    ),
    ["can_view_organization", "can_export_organization"],
  ),
  "organization.tenant_exports": definition(
    none,
    none,
    textColumns(
      "id",
      "status",
      "completedParts",
      "totalParts",
      "attemptCount",
      "safeErrorCode",
      "verifiedAt",
      "createdAt",
      "updatedAt",
    ),
    ["can_view_organization", "can_export_organization"],
    false,
    false,
    "owner",
  ),
  "organization.holidays": definition(none, none, textColumns("date"), [
    "can_view_organization",
    "can_export_organization",
  ]),
  "organization.lifecycle_blockers": definition(
    none,
    none,
    textColumns("kind", "code", "recordId", "requiredRetentionDays"),
    ["can_view_organization", "can_export_organization"],
  ),
  "onboarding.progress": definition(
    none,
    none,
    textColumns(
      "stage",
      "status",
      "blockReason",
      "completedAt",
      "completedBy",
      "updatedAt",
    ),
    ["can_view_organization", "can_export_organization"],
  ),
  "permissions.matrix": definition(
    none,
    none,
    textColumns("permissionKey", "owner", "admin", "member", "viewer"),
    ["can_view_roles", "can_export_roles"],
  ),
} as const;
