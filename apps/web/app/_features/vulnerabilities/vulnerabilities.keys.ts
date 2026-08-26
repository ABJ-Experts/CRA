const all = Object.freeze(["vulnerability-feeds"] as const);
const health = Object.freeze(["vulnerability-feeds", "health"] as const);
const syncRuns = Object.freeze((query: string) =>
  Object.freeze(["vulnerability-feeds", "sync-runs", query] as const),
);

export const vulnerabilityFeedKeys = Object.freeze({ all, health, syncRuns });
