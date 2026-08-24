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
const documents = Object.freeze(["sboms", "documents"] as const);
const documentsForRelease = Object.freeze(
  (
    productId: string,
    releaseId: string,
    query: Readonly<{ limit?: number; cursor?: string }>,
  ) =>
    Object.freeze([
      ...documents,
      "release",
      productId,
      releaseId,
      query.limit ?? 25,
      query.cursor ?? null,
    ] as const),
);
const document = Object.freeze((documentId: string) =>
  Object.freeze([...documents, documentId] as const),
);
const componentSearches = Object.freeze([
  "sboms",
  "component-searches",
] as const);
const componentSearch = Object.freeze(
  (
    documentId: string,
    query: Readonly<{ q?: string; limit?: number; cursor?: string }>,
  ) =>
    Object.freeze([
      ...componentSearches,
      documentId,
      query.q ?? null,
      query.limit ?? 50,
      query.cursor ?? null,
    ] as const),
);
const dependencyTreeChildren = Object.freeze(
  (
    documentId: string,
    query: Readonly<{
      parentComponentId?: string;
      q?: string;
      limit?: number;
      cursor?: string;
    }>,
  ) =>
    Object.freeze([
      ...documents,
      documentId,
      "dependency-tree",
      query.parentComponentId ?? null,
      query.q ?? null,
      query.limit ?? 50,
      query.cursor ?? null,
    ] as const),
);

export const sbomKeys = Object.freeze({
  all,
  jobs,
  job,
  sourceHistories,
  sourceHistory,
  validationReports,
  validationReport,
  ciCredentials,
  documents,
  documentsForRelease,
  document,
  componentSearches,
  componentSearch,
  dependencyTreeChildren,
});
