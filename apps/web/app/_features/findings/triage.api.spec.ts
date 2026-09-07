import { afterEach, describe, expect, it, vi } from "vitest";
import { vulnerabilityTriageQueueQuerySchema } from "@repo/contracts/vulnerabilities";

import { vulnerabilityTriageApi } from "./triage.api";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("vulnerabilityTriageApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes repeatable tenant filters and keyset cursor parameters", async () => {
    const fetcher = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => json({ rows: [], nextCursor: null, filterIssues: [] }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      vulnerabilityTriageApi.list({
        productIds: ["11111111-1111-4111-8111-111111111111"],
        severities: ["critical", "high"],
        cursor: vulnerabilityTriageQueueQuerySchema.parse({
          cursor: "bmV4dC1jdXJzb3I",
        }).cursor,
        limit: 50,
        sort: "lastEvaluatedAt",
        order: "desc",
      }),
    ).resolves.toMatchObject({ rows: [], nextCursor: null });

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/findings?"),
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    const path = String(fetcher.mock.calls[0]?.[0]);
    expect(path).toContain("productIds=11111111-1111-4111-8111-111111111111");
    expect(path).toContain("severities=critical");
    expect(path).toContain("severities=high");
    expect(path).toContain("cursor=bmV4dC1jdXJzb3I");
  });

  it("rejects invalid filter ranges and finding identifiers before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(() =>
      vulnerabilityTriageApi.list({ epssMin: 0.9, epssMax: 0.1 }),
    ).toThrow("The request contains invalid data.");
    expect(() => vulnerabilityTriageApi.detail("not-a-uuid")).toThrow(
      "The finding identifier is invalid.",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
