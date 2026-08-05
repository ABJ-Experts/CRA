// The golden dataset and its scorer (FR-MATCH-005).
//
// Re-exported from the package barrel so apps/api can run the SAME corpus through
// the database-backed adapter (tier 2). A subpath export would keep fixture data
// out of the main surface, but apps/api compiles with moduleResolution "node",
// which does not honour the package.json "exports" map — so the barrel it is.
export * from "./corpus";
export * from "./score";
export * from "./thresholds";
