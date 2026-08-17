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
const supportPeriods = Object.freeze((productId: string, releaseId?: string) =>
  Object.freeze(
    releaseId === undefined
      ? (["products", productId, "support-periods"] as const)
      : (["products", productId, "support-periods", releaseId] as const),
  ),
);
const supportRetention = Object.freeze(
  (productId: string, releaseId?: string) =>
    Object.freeze(
      releaseId === undefined
        ? (["products", productId, "retention"] as const)
        : (["products", productId, "retention", releaseId] as const),
    ),
);
const supportAlerts = Object.freeze((productId: string, releaseId?: string) =>
  Object.freeze(
    releaseId === undefined
      ? (["products", productId, "support-alerts"] as const)
      : (["products", productId, "support-alerts", releaseId] as const),
  ),
);
const supportAlertIntervals = Object.freeze([
  "products",
  "support-alert-intervals",
] as const);
const baselineRevisions = Object.freeze((baselineId: string) =>
  Object.freeze(["products", "baselines", baselineId, "revisions"] as const),
);
const baselineLists = Object.freeze(["products", "baselines", "list"] as const);
const baselineList = Object.freeze((query: string) =>
  Object.freeze([...baselineLists, query] as const),
);
const baselineMemberships = Object.freeze((productId: string) =>
  Object.freeze(["products", productId, "baseline-memberships"] as const),
);
const variantRelationships = Object.freeze((productId: string) =>
  Object.freeze(["products", productId, "variant-relationships"] as const),
);
const componentLinks = Object.freeze((productId: string) =>
  Object.freeze(["products", productId, "component-links"] as const),
);
const relationshipGraph = Object.freeze((productId: string) =>
  Object.freeze(["products", productId, "relationship-graph"] as const),
);
const relationshipPropagationEvents = Object.freeze((productId: string) =>
  Object.freeze([
    "products",
    productId,
    "relationship-propagation-events",
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
  supportPeriods,
  supportRetention,
  supportAlerts,
  supportAlertIntervals,
  baselineLists,
  baselineList,
  baselineRevisions,
  baselineMemberships,
  variantRelationships,
  componentLinks,
  relationshipGraph,
  relationshipPropagationEvents,
});
