const all = Object.freeze(["organizations"] as const);
const current = Object.freeze(["organizations", "current"] as const);
const onboarding = Object.freeze([
  "organizations",
  "current",
  "onboarding",
] as const);

export const organizationKeys = Object.freeze({ all, current, onboarding });
