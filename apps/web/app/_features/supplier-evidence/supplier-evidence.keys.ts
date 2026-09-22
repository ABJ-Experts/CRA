const requests = Object.freeze(["supplier-evidence", "requests"] as const);
const request = Object.freeze((requestId: string) =>
  Object.freeze([...requests, requestId] as const),
);
const reviewRequest = Object.freeze((requestId: string) =>
  Object.freeze([...request(requestId), "review"] as const),
);

export const supplierEvidenceKeys = Object.freeze({
  requests,
  request,
  reviewRequest,
});
