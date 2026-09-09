import type { VulnerabilityTriageQueueQuery } from "@repo/contracts/vulnerabilities";

const all = Object.freeze(["findings", "triage"] as const);
const queue = Object.freeze([...all, "queue"] as const);
const savedViews = Object.freeze([...all, "saved-views"] as const);
const assessments = Object.freeze([...all, "assessments"] as const);
const assessmentApprovalPolicy = Object.freeze([
  ...all,
  "assessment-approval-policy",
] as const);
const assessmentBulkOperations = Object.freeze([
  ...all,
  "assessment-bulk-operations",
] as const);
const triageSlaPolicies = Object.freeze([
  ...all,
  "triage-sla-policies",
] as const);
const remediationHistory = Object.freeze([
  ...all,
  "remediation-history",
] as const);
const vexExports = Object.freeze([...all, "vex-exports"] as const);
const vexPublicationTargets = Object.freeze([
  ...vexExports,
  "publication-targets",
] as const);

function stableQuery(query: Readonly<Partial<VulnerabilityTriageQueueQuery>>) {
  return JSON.stringify(
    Object.entries(query).filter(([, value]) => value !== undefined),
  );
}

export const vulnerabilityTriageKeys = Object.freeze({
  all,
  queue,
  assessments,
  assessmentBulkOperations,
  triageSlaPolicies,
  remediationHistory,
  vexExports,
  vexPublicationTargets,
  queueList: (
    organizationId: string | null,
    query: Readonly<Partial<VulnerabilityTriageQueueQuery>>,
  ) =>
    Object.freeze([
      ...queue,
      organizationId ?? "no-organization",
      stableQuery(query),
    ] as const),
  detail: (findingId: string) =>
    Object.freeze([...all, "detail", findingId] as const),
  remediationHistoryForFinding: (findingId: string) =>
    Object.freeze([...remediationHistory, findingId] as const),
  assessment: (findingId: string) =>
    Object.freeze([...assessments, findingId] as const),
  assessmentBulkOperation: (operationId: string) =>
    Object.freeze([...assessmentBulkOperations, operationId] as const),
  assessmentApprovalPolicy,
  vexExportPreview: (productId: string, releaseId: string) =>
    Object.freeze([...vexExports, "preview", productId, releaseId] as const),
  vexExportList: (productId: string, releaseId: string) =>
    Object.freeze([...vexExports, productId, releaseId] as const),
  vexExport: (exportId: string) =>
    Object.freeze([...vexExports, exportId] as const),
  vexPublications: (exportId: string) =>
    Object.freeze([...vexExports, exportId, "publications"] as const),
  savedViews: (organizationId: string | null) =>
    Object.freeze([
      ...savedViews,
      organizationId ?? "no-organization",
    ] as const),
});
