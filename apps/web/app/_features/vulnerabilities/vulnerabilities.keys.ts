const all = Object.freeze(["vulnerability-feeds"] as const);
const health = Object.freeze(["vulnerability-feeds", "health"] as const);
const syncRuns = Object.freeze((query: string) =>
  Object.freeze(["vulnerability-feeds", "sync-runs", query] as const),
);
const offlineBundles = Object.freeze([
  "vulnerability-feeds",
  "offline-bundles",
] as const);
const offlineBundle = Object.freeze((importId: string) =>
  Object.freeze([...offlineBundles, importId] as const),
);
const csafReconciliations = Object.freeze([
  "vulnerability-feeds",
  "csaf-reconciliations",
] as const);
const csafReconciliation = Object.freeze((canonicalId: string) =>
  Object.freeze([...csafReconciliations, canonicalId] as const),
);

export const vulnerabilityFeedKeys = Object.freeze({
  all,
  health,
  syncRuns,
  offlineBundles,
  offlineBundle,
  csafReconciliations,
  csafReconciliation,
});
