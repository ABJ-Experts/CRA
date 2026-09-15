const all = Object.freeze(["connectors"] as const);
const lists = Object.freeze(["connectors", "list"] as const);
const list = Object.freeze((query: string) =>
  Object.freeze([...lists, query] as const),
);
const detail = Object.freeze((connectorId: string) =>
  Object.freeze(["connectors", connectorId] as const),
);
const mapping = Object.freeze((connectorId: string) =>
  Object.freeze(["connectors", connectorId, "mapping"] as const),
);
const identities = Object.freeze((connectorId: string, query: string) =>
  Object.freeze(["connectors", connectorId, "identities", query] as const),
);
const syncRuns = Object.freeze((connectorId: string, query: string) =>
  Object.freeze(["connectors", connectorId, "sync-runs", query] as const),
);
const syncRun = Object.freeze((connectorId: string, runId: string) =>
  Object.freeze(["connectors", connectorId, "sync-runs", runId] as const),
);
const planItems = Object.freeze(
  (connectorId: string, runId: string, query: string) =>
    Object.freeze([
      "connectors",
      connectorId,
      "sync-runs",
      runId,
      "plan-items",
      query,
    ] as const),
);
const runConflicts = Object.freeze((connectorId: string, runId: string) =>
  Object.freeze([
    "connectors",
    connectorId,
    "sync-runs",
    runId,
    "conflicts",
  ] as const),
);
const conflict = Object.freeze((conflictId: string) =>
  Object.freeze(["connectors", "conflicts", conflictId] as const),
);
const deadLetters = Object.freeze((connectorId: string, query: string) =>
  Object.freeze(["connectors", connectorId, "dead-letters", query] as const),
);
const metricsSnapshot = Object.freeze((connectorId: string) =>
  Object.freeze(["connectors", connectorId, "metrics-snapshot"] as const),
);

export const connectorKeys = Object.freeze({
  all,
  lists,
  list,
  detail,
  mapping,
  identities,
  syncRuns,
  syncRun,
  planItems,
  runConflicts,
  conflict,
  deadLetters,
  metricsSnapshot,
});
