import type { ProbeResult } from "../domain/health-source";
export type { ProbeResult } from "../domain/health-source";

/** Adapters MUST pass this signal to their real transport, and settle on abort. */
export async function boundedProbe<T>(
  probe: (signal: AbortSignal) => Promise<T>,
  budgetMs = 250,
  parent?: AbortSignal,
): Promise<ProbeResult<T>> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (parent?.aborted) cancel();
  parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, budgetMs);
  try {
    if (controller.signal.aborted)
      return { outcome: "unreachable", reason: "probe_timeout" };
    const value = await probe(controller.signal);
    return controller.signal.aborted
      ? { outcome: "unreachable", reason: "probe_timeout" }
      : { outcome: "ready", value };
  } catch {
    return {
      outcome: "unreachable",
      reason: controller.signal.aborted
        ? "probe_timeout"
        : "source_unavailable",
    };
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", cancel);
  }
}

export async function collectBounded<T>(
  probes: readonly ((signal: AbortSignal) => Promise<T>)[],
  limits = { perProbeMs: 250, overallMs: 900, concurrency: 4 },
): Promise<readonly ProbeResult<T>[]> {
  const overall = new AbortController();
  const timer = setTimeout(() => overall.abort(), limits.overallMs);
  const results: ProbeResult<T>[] = [];
  let next = 0;
  const run = async () => {
    while (next < probes.length) {
      const index = next++;
      const probe = probes[index]!;
      results[index] = await boundedProbe(
        probe,
        limits.perProbeMs,
        overall.signal,
      );
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(limits.concurrency, probes.length) }, run),
    );
    return results;
  } finally {
    clearTimeout(timer);
  }
}
