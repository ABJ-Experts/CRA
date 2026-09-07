import type { VulnerabilityTriageQueueQuery } from "@repo/contracts/vulnerabilities";

const all = Object.freeze(["findings", "triage"] as const);
const queue = Object.freeze([...all, "queue"] as const);
const savedViews = Object.freeze([...all, "saved-views"] as const);
const assessments = Object.freeze([...all, "assessments"] as const);
const assessmentApprovalPolicy = Object.freeze([
  ...all,
  "assessment-approval-policy",
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
  assessment: (findingId: string) =>
    Object.freeze([...assessments, findingId] as const),
  assessmentApprovalPolicy,
  savedViews: (organizationId: string | null) =>
    Object.freeze([
      ...savedViews,
      organizationId ?? "no-organization",
    ] as const),
});
