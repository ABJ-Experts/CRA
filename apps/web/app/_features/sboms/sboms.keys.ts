export function getSbomKeys(organizationId: string | null) {
  const scope = ["sboms", "organization", organizationId ?? "none"] as const;
  const all = Object.freeze(scope);
  const compositeReviews = Object.freeze([
    ...scope,
    "composite-reviews",
  ] as const);
  const compositeReview = Object.freeze((reviewId: string) =>
    Object.freeze([...compositeReviews, reviewId] as const),
  );
  const supplierRequests = Object.freeze([
    ...scope,
    "supplier-requests",
  ] as const);
  const supplierRequestList = Object.freeze(
    (
      query: Readonly<{
        productId?: string;
        releaseId?: string;
        state?: string;
        limit?: number;
        cursor?: string;
      }>,
    ) =>
      Object.freeze([
        ...supplierRequests,
        query.productId ?? null,
        query.releaseId ?? null,
        query.state ?? null,
        query.limit ?? 25,
        query.cursor ?? null,
      ] as const),
  );
  const jobs = Object.freeze([...scope, "jobs"] as const);
  const job = Object.freeze((jobId: string) =>
    Object.freeze([...jobs, jobId] as const),
  );
  const sourceHistories = Object.freeze([
    ...scope,
    "source-histories",
  ] as const);
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
    ...scope,
    "validation-reports",
  ] as const);
  const validationReport = Object.freeze((sourceId: string) =>
    Object.freeze([...validationReports, sourceId] as const),
  );
  const ciCredentials = Object.freeze([...scope, "ci-credentials"] as const);
  const documents = Object.freeze([...scope, "documents"] as const);
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
    ...scope,
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
  const qualityReports = Object.freeze([...scope, "quality-reports"] as const);
  const qualityReport = Object.freeze((sourceId: string) =>
    Object.freeze([...qualityReports, sourceId] as const),
  );
  const qualityFindings = Object.freeze(
    (
      sourceId: string,
      query: Readonly<{
        limit?: number;
        cursor?: string;
        severity?: string;
        kind?: string;
      }>,
    ) =>
      Object.freeze([
        ...qualityReports,
        sourceId,
        "findings",
        query.limit ?? 50,
        query.cursor ?? null,
        query.severity ?? null,
        query.kind ?? null,
      ] as const),
  );
  const diffReports = Object.freeze([...scope, "diff-reports"] as const);
  const sourceDiffReports = Object.freeze([
    ...scope,
    "source-diff-reports",
  ] as const);
  const sourceDiffReport = Object.freeze(
    (sourceId: string, query: Readonly<{ baseSourceId?: string }>) =>
      Object.freeze([
        ...sourceDiffReports,
        sourceId,
        query.baseSourceId ?? null,
      ] as const),
  );
  const diffReport = Object.freeze((diffId: string) =>
    Object.freeze([...diffReports, diffId] as const),
  );
  const diffComponents = Object.freeze(
    (
      diffId: string,
      query: Readonly<{
        limit?: number;
        cursor?: string;
        change?: string;
        ecosystem?: string;
        q?: string;
      }>,
    ) =>
      Object.freeze([
        ...diffReport(diffId),
        "components",
        query.limit ?? 50,
        query.cursor ?? null,
        query.change ?? null,
        query.ecosystem ?? null,
        query.q ?? null,
      ] as const),
  );
  const diffFindings = Object.freeze(
    (diffId: string, query: Readonly<{ limit?: number; cursor?: string }>) =>
      Object.freeze([
        ...diffReport(diffId),
        "findings",
        query.limit ?? 50,
        query.cursor ?? null,
      ] as const),
  );

  return Object.freeze({
    all,
    compositeReviews,
    compositeReview,
    supplierRequests,
    supplierRequestList,
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
    qualityReports,
    qualityReport,
    qualityFindings,
    sourceDiffReports,
    sourceDiffReport,
    diffReports,
    diffReport,
    diffComponents,
    diffFindings,
  });
}

export const sbomKeys = getSbomKeys(null);
