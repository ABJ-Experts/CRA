import { afterEach, describe, expect, it, vi } from "vitest";

import { customFrameworksApi } from "./custom-frameworks.api";

const key = "22222222-2222-4222-8222-222222222222";
const draftId = "11111111-1111-4111-8111-111111111111";
const content = {
  title: "Internal controls",
  editionDate: "2026-09-25",
  language: "en",
  attribution: "Internal policy",
  requirements: [
    {
      requirementKey: "control-1",
      identifier: "INT-1",
      parentKey: null,
      position: 1,
      heading: "Design review",
      text: "Document design control decisions.",
      sourceReference: "Policy 1",
    },
  ],
};

const summary = {
  draftId,
  packKey: "custom.11111111-1111-4111-8111-111111111111",
  title: content.title,
  status: "draft",
  revision: 1,
  latestVersionKey: null,
  selectedVersionKey: null,
  contentHash: null,
  archivedAt: null,
  updatedAt: "2026-09-25T00:00:00Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("CustomFrameworksApi", () => {
  it("parses list and detail responses through shared schemas", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [summary], nextOffset: null }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...summary, content }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(customFrameworksApi.list()).resolves.toMatchObject({
      items: [{ packKey: summary.packKey }],
    });
    await expect(
      customFrameworksApi.detail(summary.draftId),
    ).resolves.toMatchObject({
      content: { title: content.title },
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/frameworks/custom?limit=20&offset=0",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/v1/frameworks/custom/${summary.draftId}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("rejects unsafe import content before sending a create command", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(() =>
      customFrameworksApi.parseImport({
        schemaVersion: 1,
        kind: "customer_defined",
        content: {
          ...content,
          requirements: [{ ...content.requirements[0], text: "<b>bad</b>" }],
        },
      }),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects non-JSON dry-run payloads before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      customFrameworksApi.validate(() => "invalid"),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends create and revisioned commands once and surfaces conflicts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ...summary, contentHash: "a".repeat(64) }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Conflict" }), { status: 409 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      customFrameworksApi.command(null, {
        action: "create_draft",
        content,
        idempotencyKey: key,
      }),
    ).resolves.toMatchObject({ packKey: summary.packKey });
    await expect(
      customFrameworksApi.command(summary.draftId, {
        action: "publish_version",
        expectedRevision: 1,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/frameworks/custom",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/v1/frameworks/custom/${summary.draftId}`,
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("parses export query input before exporting the current draft or an exact version", async () => {
    const responseBody = JSON.stringify({
      schemaVersion: 1,
      kind: "customer_defined",
      content,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(responseBody, { status: 200 }))
      .mockResolvedValueOnce(new Response(responseBody, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(customFrameworksApi.export(draftId)).resolves.toMatchObject({
      content: { title: content.title },
    });
    await expect(
      customFrameworksApi.export(draftId, "v1"),
    ).resolves.toMatchObject({ content: { title: content.title } });
    expect(() => customFrameworksApi.export(draftId, "../v1")).toThrow();
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/v1/frameworks/custom/${draftId}/export`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/v1/frameworks/custom/${draftId}/export?versionKey=v1`,
      expect.objectContaining({ method: "GET" }),
    );
  });
});
