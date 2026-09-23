const requests = Object.freeze(["supplier-evidence", "requests"] as const);
const request = Object.freeze((requestId: string) =>
  Object.freeze([...requests, requestId] as const),
);
const reviewRequest = Object.freeze((requestId: string) =>
  Object.freeze([...request(requestId), "review"] as const),
);
const extraction = Object.freeze(
  (requestId: string, submissionId: string, productId: string) =>
    Object.freeze([
      ...reviewRequest(requestId),
      "extraction",
      submissionId,
      productId,
    ] as const),
);
const reminderSettings = Object.freeze([
  "supplier-evidence",
  "reminder-settings",
] as const);
const metricsRoot = Object.freeze(["supplier-evidence", "metrics"] as const);
const metrics = Object.freeze(
  (
    query: Readonly<{
      from: string;
      to: string;
      productId?: string;
      supplierId?: string;
    }>,
  ) => Object.freeze(["supplier-evidence", "metrics", query] as const),
);
const overdueRoot = Object.freeze(["supplier-evidence", "overdue"] as const);
const overdue = Object.freeze(
  (
    query: Readonly<{
      productId?: string;
      supplierId?: string;
      limit?: number;
      cursor?: string;
    }>,
  ) => Object.freeze(["supplier-evidence", "overdue", query] as const),
);

export const supplierEvidenceKeys = Object.freeze({
  requests,
  request,
  reviewRequest,
  extraction,
  reminderSettings,
  metricsRoot,
  metrics,
  overdueRoot,
  overdue,
});
