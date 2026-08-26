import { afterEach, describe, expect, it, vi } from "vitest";

import { vulnerabilityFeedsApi } from "./vulnerabilities.api";

const OBSERVED_AT = "2026-08-26T12:00:00.000Z";

function feed(
  feedKey: "nvd" | "osv" | "cisa_kev" | "epss" | "github_advisory",
) {
  return {
    feedKey,
    enabled: true,
    status: "healthy",
    freshness: "fresh",
    scheduleIntervalSeconds: 86_400,
    staleAfterSeconds: 172_800,
    lastAttemptedAt: OBSERVED_AT,
    lastSuccessfulCompleteAt: OBSERVED_AT,
    lastCompleteSnapshotAt: OBSERVED_AT,
    mirrorAgeSeconds: 30,
    nextScheduledAt: "2026-08-27T12:00:00.000Z",
    currentRunId: null,
    currentRecordCount: 10,
    queueDepth: 0,
    oldestQueuedAgeSeconds: null,
    deadLetterCount: 0,
    failureCount: 0,
    latestFailureCode: null,
    latestFailureAt: null,
  };
}

const run = {
  id: "00000000-0000-4000-8000-000000000001",
  feedKey: "nvd",
  status: "queued",
  attempt: 0,
  maxAttempts: 5,
  recordsFetched: 0,
  recordsStaged: 0,
  recordsPromoted: 0,
  checkpoint: null,
  correlationId: "00000000-0000-4000-8000-000000000002",
  failureCode: null,
  failureReason: null,
  retryAt: null,
  startedAt: null,
  completedAt: null,
  createdAt: OBSERVED_AT,
  updatedAt: OBSERVED_AT,
};

describe("vulnerabilityFeedsApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the authenticated local health boundary and parses all five mirrors", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            observedAt: OBSERVED_AT,
            feeds: [
              feed("nvd"),
              feed("osv"),
              feed("cisa_kev"),
              feed("epss"),
              feed("github_advisory"),
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);

    const response = await vulnerabilityFeedsApi.health();
    expect(response.observedAt).toBe(OBSERVED_AT);
    expect(response.feeds[0]).toMatchObject({ feedKey: "nvd" });
    expect(fetcher).toHaveBeenCalledWith("/api/v1/vulnerability-feeds/health", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: undefined,
      headers: undefined,
      body: undefined,
    });
  });

  it("validates a trigger body and uses the feed-scoped sync route", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ run }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityFeedsApi.sync("nvd", { force: true }),
    ).resolves.toEqual({ run });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/vulnerability-feeds/nvd/sync",
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: undefined,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      },
    );
  });

  it("rejects malformed replay identifiers before sending a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(() =>
      vulnerabilityFeedsApi.replay("nvd", "not-a-run", { reason: "Retry" }),
    ).toThrow("The vulnerability sync run identifier is invalid.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("replays a dead-letter run through the feed-scoped endpoint", async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ run }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityFeedsApi.replay(
        "nvd",
        "00000000-0000-4000-8000-000000000001",
        { reason: "Provider recovered." },
      ),
    ).resolves.toEqual({ run });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/vulnerability-feeds/nvd/sync-runs/00000000-0000-4000-8000-000000000001/replay",
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: undefined,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Provider recovered." }),
      },
    );
  });
});
