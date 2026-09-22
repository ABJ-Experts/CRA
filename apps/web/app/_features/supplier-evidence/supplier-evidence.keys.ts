const requests = Object.freeze(["supplier-evidence", "requests"] as const);
const request = Object.freeze((requestId: string) =>
  Object.freeze([...requests, requestId] as const),
);

export const supplierEvidenceKeys = Object.freeze({ requests, request });
