import type { ReleaseLifecycleState } from "@repo/contracts/products";

export type ReleaseLifecycleCurrentDataRequirement =
  "placed_on_market_at" | "active_market_availability";

export type ReleaseLifecycleTransitionDecision =
  | Readonly<{ outcome: "allowed" }>
  | Readonly<{ outcome: "invalid_transition" }>
  | Readonly<{
      outcome: "requires_current_data";
      requirements: readonly ReleaseLifecycleCurrentDataRequirement[];
    }>;

const placementRequirements = Object.freeze([
  "placed_on_market_at",
  "active_market_availability",
] as const);

/**
 * Decides only the lifecycle edge. Current placement facts deliberately stay
 * outside this function so an application service can obtain them atomically.
 */
export function evaluateReleaseLifecycleTransition(
  currentState: ReleaseLifecycleState,
  targetState: ReleaseLifecycleState,
): ReleaseLifecycleTransitionDecision {
  if (targetState === "withdrawn" && currentState !== "withdrawn") {
    return Object.freeze({ outcome: "allowed" });
  }

  switch (currentState) {
    case "development":
      return targetState === "placed_on_market"
        ? Object.freeze({
            outcome: "requires_current_data" as const,
            requirements: placementRequirements,
          })
        : Object.freeze({ outcome: "invalid_transition" });
    case "placed_on_market":
      return targetState === "in_support"
        ? Object.freeze({ outcome: "allowed" })
        : Object.freeze({ outcome: "invalid_transition" });
    case "in_support":
      return targetState === "end_of_support"
        ? Object.freeze({ outcome: "allowed" })
        : Object.freeze({ outcome: "invalid_transition" });
    case "end_of_support":
    case "withdrawn":
      return Object.freeze({ outcome: "invalid_transition" });
  }
}
