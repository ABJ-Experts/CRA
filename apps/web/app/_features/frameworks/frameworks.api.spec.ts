import { afterEach, describe, expect, it, vi } from "vitest";

import { frameworksApi } from "./frameworks.api";

const version = {
  versionKey: "oj-2024-11-20",
  editionDate: "2024-11-20",
  language: "en",
  sourceUrl:
    "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847",
  sourceReference: "OJ L 2024/2847, Annex I",
  attribution: "EUR-Lex",
  contentHash: "a".repeat(64),
};

afterEach(() => vi.unstubAllGlobals());

describe("FrameworksApi", () => {
  it("parses a bounded upgrade preview and keeps a failed commit single-shot", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            packKey: "cra",
            sourceVersionKey: "v1",
            targetVersionKey: "v2",
            selectionRevision: 1,
            sourceHash: "a".repeat(64),
            targetHash: "b".repeat(64),
            fingerprint: "c".repeat(64),
            diff: {
              added: [],
              removed: [],
              changed: [],
              split: [],
              merged: [],
            },
            impacts: [],
            nextCursor: null,
            totalImpacts: 0,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Conflict" }), { status: 409 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      frameworksApi.upgradePreview("cra", "v2"),
    ).resolves.toMatchObject({ totalImpacts: 0 });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/frameworks/cra/upgrades/v2/preview?limit=50",
      expect.objectContaining({ method: "GET" }),
    );
    await expect(
      frameworksApi.commitUpgrade(
        "cra",
        "11111111-1111-4111-8111-111111111111",
        {
          expectedReviewRevision: 1,
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects tenant-unsafe evidence reuse inputs before sending a request", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() =>
      frameworksApi.crosswalkEvidenceReuse("bad", "also-bad"),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("parses catalog and bounded tree pages", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            packs: [
              {
                packKey: "cra",
                title: "CRA",
                versions: [version],
                selection: null,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            packKey: "cra",
            versionKey: version.versionKey,
            editionDate: version.editionDate,
            language: version.language,
            requirements: [
              {
                requirementKey: "part-i-1",
                identifier: "1",
                parentKey: null,
                position: 1,
                depth: 0,
                heading: "Security",
                text: "Products shall be secure.",
                sourceReference: "Annex I, Part I, 1",
              },
            ],
            nextCursor: null,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(frameworksApi.catalog()).resolves.toMatchObject({
      packs: [{ packKey: "cra" }],
    });
    await expect(
      frameworksApi.tree("cra", version.versionKey),
    ).resolves.toMatchObject({
      requirements: [{ requirementKey: "part-i-1" }],
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/v1/frameworks/cra/versions/${version.versionKey}/tree?limit=100`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates a catalog continuation before requesting the next page", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ packs: [], nextCursor: "Mg" }), {
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(frameworksApi.catalog(undefined, "Mg", 2)).resolves.toEqual({
      packs: [],
      nextCursor: "Mg",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/frameworks?cursor=Mg&limit=2",
      expect.objectContaining({ method: "GET" }),
    );
    expect(() => frameworksApi.catalog(undefined, undefined, 101)).toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("validates selection before PUT and never replays a failed write", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Conflict" }), { status: 409 }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(() =>
      frameworksApi.select("invalid/key", {
        versionKey: version.versionKey,
        enabled: true,
        expectedRevision: null,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).toThrow("Invalid framework key");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      frameworksApi.select("cra", {
        versionKey: version.versionKey,
        enabled: true,
        expectedRevision: null,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/frameworks/cra/selection",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("rejects malformed successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ packs: [{ packKey: "cra" }] }), {
          status: 200,
        }),
      ),
    );
    await expect(frameworksApi.catalog()).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("rejects malformed tree keys before sending a request", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() => frameworksApi.tree("cra-annex-i", "../other-version")).toThrow(
      "Invalid framework version",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
