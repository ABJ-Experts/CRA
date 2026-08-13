const all = Object.freeze(["products"] as const);
const lists = Object.freeze(["products", "list"] as const);
const list = Object.freeze((query: string) =>
  Object.freeze([...lists, query] as const),
);
const details = Object.freeze(["products", "detail"] as const);
const detail = Object.freeze((productId: string) =>
  Object.freeze([...details, productId] as const),
);
const releases = Object.freeze((productId: string) =>
  Object.freeze(["products", productId, "releases"] as const),
);
const release = Object.freeze((productId: string, releaseId: string) =>
  Object.freeze(["products", productId, "releases", releaseId] as const),
);
const memberStates = Object.freeze(["products", "member-states"] as const);
const marketAvailability = Object.freeze(
  (productId: string, releaseId: string) =>
    Object.freeze([
      "products",
      productId,
      "releases",
      releaseId,
      "market-availability",
    ] as const),
);
const lifecycleTimeline = Object.freeze(
  (productId: string, releaseId: string) =>
    Object.freeze([
      "products",
      productId,
      "releases",
      releaseId,
      "lifecycle-timeline",
    ] as const),
);

export const productKeys = Object.freeze({
  all,
  lists,
  list,
  details,
  detail,
  releases,
  release,
  memberStates,
  marketAvailability,
  lifecycleTimeline,
});
