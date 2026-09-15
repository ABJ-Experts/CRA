import { evaluateReleaseLifecycleTransition } from "./release-lifecycle-policy";

describe("evaluateReleaseLifecycleTransition", () => {
  it.each([
    ["development", "placed_on_market"],
    ["placed_on_market", "in_support"],
    ["in_support", "end_of_support"],
    ["development", "withdrawn"],
    ["placed_on_market", "withdrawn"],
    ["in_support", "withdrawn"],
    ["end_of_support", "withdrawn"],
  ] as const)(
    "accepts the permitted %s -> %s edge",
    (currentState, targetState) => {
      const decision = evaluateReleaseLifecycleTransition(
        currentState,
        targetState,
      );

      expect(decision).toEqual(
        targetState === "placed_on_market"
          ? {
              outcome: "requires_current_data",
              requirements: [
                "placed_on_market_at",
                "active_market_availability",
              ],
            }
          : { outcome: "allowed" },
      );
    },
  );

  it.each([
    ["development", "development"],
    ["development", "in_support"],
    ["development", "end_of_support"],
    ["placed_on_market", "development"],
    ["placed_on_market", "placed_on_market"],
    ["placed_on_market", "end_of_support"],
    ["in_support", "development"],
    ["in_support", "placed_on_market"],
    ["in_support", "in_support"],
    ["end_of_support", "development"],
    ["end_of_support", "placed_on_market"],
    ["end_of_support", "in_support"],
    ["end_of_support", "end_of_support"],
    ["withdrawn", "development"],
    ["withdrawn", "placed_on_market"],
    ["withdrawn", "in_support"],
    ["withdrawn", "end_of_support"],
    ["withdrawn", "withdrawn"],
  ] as const)(
    "rejects the prohibited %s -> %s edge",
    (currentState, targetState) => {
      expect(
        evaluateReleaseLifecycleTransition(currentState, targetState),
      ).toEqual({
        outcome: "invalid_transition",
      });
    },
  );

  it("keeps prerequisites separate from infrastructure-provided current data", () => {
    const decision = evaluateReleaseLifecycleTransition(
      "development",
      "placed_on_market",
    );

    expect(decision).toEqual({
      outcome: "requires_current_data",
      requirements: ["placed_on_market_at", "active_market_availability"],
    });
  });
});
