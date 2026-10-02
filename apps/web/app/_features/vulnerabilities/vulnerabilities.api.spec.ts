import { afterEach, describe, expect, it, vi } from "vitest";

import { vulnerabilityFeedsApi } from "./vulnerabilities.api";

const OBSERVED_AT = "2026-08-26T12:00:00.000Z";

function feed(
  feedKey:
    "nvd" | "osv" | "cisa_kev" | "epss" | "github_advisory" | "vendor_csaf",
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

  it("uses the authenticated local health boundary and parses every mirror", async () => {
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
              feed("vendor_csaf"),
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

  it("submits the complete signed bundle as parsed multipart parts", async () => {
    const response = {
      import: {
        id: "00000000-0000-4000-8000-000000000005",
        status: "awaiting_confirmation",
        bundleSha256: "a".repeat(64),
        manifest: {
          format: "cra.vulnerability.offline-bundle",
          schemaVersion: "1.0",
          bundleVersion: "1.0.0",
          createdAt: OBSERVED_AT,
          signingKeyId: "offline-key-2026",
          compatibility: {
            minimumApplicationVersion: "1.0.0",
            maximumApplicationVersionExclusive: "2.0.0",
          },
          payloads: [
            {
              feedKey: "vendor_csaf",
              path: "vendor/csaf.json",
              sha256: "b".repeat(64),
              byteLength: 12,
              schemaVersion: "2.0",
              sourceSnapshotAt: OBSERVED_AT,
            },
          ],
        },
        signature: {
          algorithm: "Ed25519",
          keyId: "offline-key-2026",
          status: "verified",
          verifiedAt: OBSERVED_AT,
        },
        compatibility: { status: "compatible", reason: null },
        estimatedChanges: {
          recordsToCreate: 0,
          recordsToUpdate: 0,
          recordsToWithdraw: 0,
        },
        sourceSnapshotAt: OBSERVED_AT,
        sourceSnapshotAgeSeconds: 0,
        failureCode: null,
        createdAt: OBSERVED_AT,
        updatedAt: OBSERVED_AT,
        completedAt: null,
      },
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(response), { status: 202 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityFeedsApi.preflightOfflineBundle(
        {
          manifest: new File(["{}"], "manifest.json"),
          signature: new File(["sig"], "manifest.sig"),
          payloads: [
            {
              file: new File(["payload"], "csaf.json"),
              manifestPath: "vendor/csaf.json",
            },
          ],
        },
        { idempotencyKey: "00000000-0000-4000-8000-000000000006" },
      ),
    ).resolves.toEqual(response);

    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const body = calls[0]?.[1].body as FormData;
    expect(calls[0]?.[0]).toBe(
      "/api/v1/vulnerability-feeds/offline-bundles/preflight",
    );
    expect(body.get("idempotencyKey")).toBe(
      "00000000-0000-4000-8000-000000000006",
    );
    expect((body.get("payloads") as File).name).toBe("vendor/csaf.json");
  });

  it("rejects malformed offline import identifiers before requesting status", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(() =>
      vulnerabilityFeedsApi.offlineBundleImport("not-a-uuid"),
    ).toThrow("The offline bundle import identifier is invalid.");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
