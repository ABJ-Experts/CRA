const productSummary = Object.freeze((productId: string, releaseId?: string) =>
  Object.freeze([
    "findings",
    "product-impact-summary",
    productId,
    releaseId ?? "all-releases",
  ] as const),
);

export const findingImpactKeys = Object.freeze({
  all: Object.freeze(["findings"] as const),
  productSummary,
});
