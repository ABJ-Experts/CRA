import { boundedProbe, collectBounded } from "./bounded-probe";

describe("bounded source collection", () => {
  it("aborts the actual operation at its budget", async () => {
    let aborted = false;
    const result = await boundedProbe(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("secret hostname"));
          });
        }),
      5,
    );
    expect(aborted).toBe(true);
    expect(result).toEqual({ outcome: "unreachable", reason: "probe_timeout" });
  });
  it("isolates errors without exposing provider messages", async () => {
    await expect(
      boundedProbe(() => Promise.reject(new Error("secret"))),
    ).resolves.toEqual({
      outcome: "unreachable",
      reason: "source_unavailable",
    });
    await expect(boundedProbe(() => Promise.resolve(42))).resolves.toEqual({
      outcome: "ready",
      value: 42,
    });
  });
  it("limits concurrent operations to four and retains independent results", async () => {
    let active = 0;
    let maximum = 0;
    const result = await collectBounded(
      Array.from({ length: 9 }, (_, index) => async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return index;
      }),
    );
    expect(maximum).toBe(4);
    expect(result).toHaveLength(9);
    expect(result[8]).toEqual({ outcome: "ready", value: 8 });
  });
  it("cancels inflight and never starts new work after the overall budget", async () => {
    const started = jest.fn();
    const result = await collectBounded(
      Array.from({ length: 8 }, () => (signal: AbortSignal) => {
        started();
        return new Promise<never>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }),
      { perProbeMs: 100, overallMs: 5, concurrency: 4 },
    );
    expect(started).toHaveBeenCalledTimes(4);
    expect(result.every((item) => item.outcome === "unreachable")).toBe(true);
  });
});
