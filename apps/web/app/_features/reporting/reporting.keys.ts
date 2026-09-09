import type { ReportingObligationListQuery } from "@repo/contracts/reporting";

const all = Object.freeze(["reporting", "obligations"] as const);

function stableQuery(query: Readonly<Partial<ReportingObligationListQuery>>) {
  return JSON.stringify(
    Object.entries(query).filter(([, value]) => value !== undefined),
  );
}

export const reportingKeys = Object.freeze({
  all,
  list: (query: Readonly<Partial<ReportingObligationListQuery>>) =>
    Object.freeze([...all, "list", stableQuery(query)] as const),
  detail: (obligationId: string) =>
    Object.freeze([...all, "detail", obligationId] as const),
  deadlineSummary: () => Object.freeze([...all, "deadline-summary"] as const),
});
