const all = Object.freeze(["sboms"] as const);
const jobs = Object.freeze(["sboms", "jobs"] as const);
const job = Object.freeze((jobId: string) =>
  Object.freeze([...jobs, jobId] as const),
);
const sourceHistories = Object.freeze(["sboms", "source-histories"] as const);
const sourceHistory = Object.freeze(
  (
    productId: string,
    releaseId: string,
    query: Readonly<{ limit?: number; cursor?: string }>,
  ) =>
    Object.freeze([
      ...sourceHistories,
      productId,
      releaseId,
      query.limit ?? 25,
      query.cursor ?? null,
    ] as const),
);
const validationReports = Object.freeze([
  "sboms",
  "validation-reports",
] as const);
const validationReport = Object.freeze((sourceId: string) =>
  Object.freeze([...validationReports, sourceId] as const),
);
const ciCredentials = Object.freeze(["sboms", "ci-credentials"] as const);

export const sbomKeys = Object.freeze({
  all,
  jobs,
  job,
  sourceHistories,
  sourceHistory,
  validationReports,
  validationReport,
  ciCredentials,
});
