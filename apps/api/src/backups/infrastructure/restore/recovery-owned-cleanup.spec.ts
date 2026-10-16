/* eslint-disable @typescript-eslint/require-await -- Native port doubles remain asynchronous. */
import { removeOwnedRecoveryResources } from "./recovery-owned-cleanup";

const state = {
  name: "owned-target",
  network: "owned-network",
  ownership: { feature: "m15-05", instance: "instance" },
  containerAttempted: true,
  networkAttempted: true,
};
describe("owned recovery resource cleanup", () => {
  it("does not adopt absent resources and ignores inherited image metadata", async () => {
    const absent = jest.fn(async () => "");
    await removeOwnedRecoveryResources(state, absent);
    expect(absent.mock.calls).toHaveLength(2);
    const run = jest.fn(async (args: readonly string[]) =>
      args.includes("{{.Names}}")
        ? state.name
        : args.includes("{{.Name}}")
          ? state.network
          : JSON.stringify({
              ...state.ownership,
              unrelatedImageLabel: "allowed",
            }),
    );
    await removeOwnedRecoveryResources(state, run);
    expect(run).toHaveBeenCalledWith(["rm", "--force", state.name]);
    expect(run).toHaveBeenCalledWith(["network", "rm", state.network]);
    const untouched = jest.fn(async () => "");
    await removeOwnedRecoveryResources(
      { ...state, containerAttempted: false, networkAttempted: false },
      untouched,
    );
    expect(untouched).not.toHaveBeenCalled();
  });
  it("preserves resources if full ownership or Docker availability cannot be established", async () => {
    for (const labels of [
      "invalid",
      "null",
      "[]",
      "{}",
      '{"feature":"m15-05","instance":"foreign"}',
    ]) {
      const run = jest.fn(async (args: readonly string[]) =>
        args.includes("{{.Names}}") ? state.name : labels,
      );
      await expect(removeOwnedRecoveryResources(state, run)).rejects.toThrow(
        "recovery_cleanup_unsafe",
      );
      expect(run.mock.calls.some(([args]) => args[0] === "rm")).toBe(false);
    }
    await expect(
      removeOwnedRecoveryResources(state, async () => {
        throw new Error("daemon unavailable");
      }),
    ).rejects.toThrow();
  });
  it("bounds network removal retries and preserves unknown attached resources", async () => {
    let attempts = 0;
    const run = jest.fn(async (args: readonly string[]) => {
      if (args[0] === "network" && args[1] === "rm") {
        attempts += 1;
        throw new Error("foreign endpoint still attached");
      }
      return args.includes("{{.Name}}")
        ? state.network
        : JSON.stringify(state.ownership);
    });
    await expect(
      removeOwnedRecoveryResources(
        { ...state, containerAttempted: false },
        run,
      ),
    ).rejects.toThrow("recovery_cleanup_failed");
    expect(attempts).toBe(3);
  });
});
