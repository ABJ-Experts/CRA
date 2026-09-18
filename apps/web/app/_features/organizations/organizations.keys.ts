const all = Object.freeze(["organizations"] as const);
const current = Object.freeze(["organizations", "current"] as const);
const onboarding = Object.freeze([
  "organizations",
  "current",
  "onboarding",
] as const);
const settings = Object.freeze(["organizations", "current", "settings"] as const);
const settingsCatalog = Object.freeze([
  "organizations",
  "current",
  "settings",
  "catalog",
] as const);
const retention = Object.freeze(["organizations", "current", "retention"] as const);
const lifecycle = Object.freeze(["organizations", "current", "lifecycle"] as const);
const legalEntities = Object.freeze([
  "organizations",
  "current",
  "legal-entities",
] as const);
const branding = Object.freeze(["organizations", "current", "branding"] as const);
const brandingPreview = Object.freeze([...branding, "preview"] as const);
const exportsKey = Object.freeze(["organizations", "current", "exports"] as const);
const latestExport = Object.freeze([...exportsKey, "latest"] as const);
const exportStatus = Object.freeze((exportId: string) =>
  Object.freeze([...exportsKey, exportId] as const),
);

export const organizationKeys = Object.freeze({
  all,
  current,
  onboarding,
  settings,
  settingsCatalog,
  retention,
  lifecycle,
  legalEntities,
  branding,
  brandingPreview,
  exports: exportsKey,
  latestExport,
  exportStatus,
});
