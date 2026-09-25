import { afterEach, describe, expect, it, vi } from "vitest";

import { controlsApi } from "./controls.api";

const controlId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";

afterEach(() => vi.unstubAllGlobals());

describe("ControlsApi", () => {
  it("validates a create command before POST and does not replay a conflict", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Conflict" }), { status: 409 }),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      controlsApi.create({
        title: "<script>alert(1)</script>",
        description: "Review design controls.",
        ownerUserId: controlId,
        status: "not_started",
        expectedRevision: null,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      controlsApi.create({
        title: "Security design review",
        description: "Review design controls.",
        ownerUserId: controlId,
        status: "not_started",
        expectedRevision: null,
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/frameworks/controls",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects invalid path and product identifiers without a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() => controlsApi.get("../other-control")).toThrow(
      "Invalid control ID",
    );
    expect(() =>
      controlsApi.coverage("cra-annex-i", "oj-2024-11-20", "wrong-product"),
    ).toThrow("The request contains invalid data");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("parses successful list responses and rejects malformed success", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ controls: [], nextCursor: null }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ controls: [{ id: controlId }], nextCursor: null }),
          {
            status: 200,
          },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(controlsApi.list()).resolves.toEqual({
      controls: [],
      nextCursor: null,
    });
    await expect(controlsApi.list()).rejects.toMatchObject({
      kind: "invalid_response",
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/v1/frameworks/controls?limit=50",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("passes explicit product scope to coverage and mapping writes", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ controlId, revision: 2, mappingId: key }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await controlsApi.addMapping(controlId, {
      packKey: "cra-annex-i",
      versionKey: "oj-2024-11-20",
      requirementKey: "part-i-1",
      rationale: "Applies to the selected product.",
      productIds: [productId],
      expectedRevision: 1,
      idempotencyKey: key,
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/frameworks/controls/${controlId}/mappings`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(productId),
      }),
    );
  });

  it("parses owner candidates, detail, and product coverage", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            owners: [{ id: controlId, displayName: "Active owner" }],
            nextCursor: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: controlId,
            title: "Secure updates",
            description: "Review updates.",
            ownerUserId: controlId,
            ownerActive: true,
            status: "not_started",
            revision: 1,
            archivedAt: null,
            createdAt: "2026-09-24T00:00:00Z",
            updatedAt: "2026-09-24T00:00:00Z",
            evidenceLinks: [],
            evidenceRestricted: false,
            mappings: [],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            packKey: "cra-annex-i",
            versionKey: "oj-2024-11-20",
            productId,
            calculation: {
              status: "current",
              calculatedAt: "2026-09-24T10:00:00Z",
            },
            summary: {
              totalRequirements: 0,
              applicableRequirements: 0,
              excludedRequirements: 0,
              evidenceBackedRequirements: 0,
              gapRequirements: 0,
            },
            requirements: [],
            nextCursor: null,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(controlsApi.ownerCandidates()).resolves.toMatchObject({
      owners: [{ displayName: "Active owner" }],
    });
    await expect(controlsApi.get(controlId)).resolves.toMatchObject({
      id: controlId,
    });
    await expect(
      controlsApi.coverage(
        "cra-annex-i",
        "oj-2024-11-20",
        productId,
        "next-page",
      ),
    ).resolves.toMatchObject({ productId });
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `/api/v1/frameworks/cra-annex-i/versions/oj-2024-11-20/coverage?productId=${productId}&limit=100&cursor=next-page`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates applicability commands and sends a filtered coverage query", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            packKey: "cra-annex-i",
            versionKey: "oj-2024-11-20",
            productId,
            calculation: {
              status: "current",
              calculatedAt: "2026-09-24T10:00:00Z",
            },
            summary: {
              totalRequirements: 0,
              applicableRequirements: 0,
              excludedRequirements: 0,
              evidenceBackedRequirements: 0,
              gapRequirements: 0,
            },
            requirements: [],
            nextCursor: null,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            state: "not_applicable",
            reason: "Not used",
            revision: 1,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    await controlsApi.coverage(
      "cra-annex-i",
      "oj-2024-11-20",
      productId,
      undefined,
      undefined,
      "gaps",
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/v1/frameworks/cra-annex-i/versions/oj-2024-11-20/coverage?productId=${productId}&limit=100&filter=gaps`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(() =>
      controlsApi.updateApplicability(
        "cra-annex-i",
        "oj-2024-11-20",
        "../escape",
        {
          productId,
          state: "not_applicable",
          reason: "Not used",
          expectedRevision: 0,
          idempotencyKey: key,
        },
      ),
    ).toThrow();
    await controlsApi.updateApplicability(
      "cra-annex-i",
      "oj-2024-11-20",
      "part-i-1",
      {
        productId,
        state: "not_applicable",
        reason: "Not used",
        expectedRevision: 0,
        idempotencyKey: key,
      },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/v1/frameworks/cra-annex-i/versions/oj-2024-11-20/requirements/part-i-1/applicability",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining(productId),
      }),
    );
  });

  it("sends each mutation once with a parsed body and response", async () => {
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ controlId, revision: 2 }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const mutation = { expectedRevision: 1, idempotencyKey: key };
    const scalar = {
      title: "Secure updates",
      description: "Review updates.",
      ownerUserId: controlId,
      status: "in_progress" as const,
    };
    await controlsApi.update(controlId, { ...scalar, ...mutation });
    await controlsApi.archive(controlId, mutation);
    await controlsApi.linkEvidence(controlId, {
      evidenceVersionId: key,
      productId,
      ...mutation,
    });
    await controlsApi.endEvidenceLink(controlId, key, mutation);
    const mapping = {
      packKey: "cra-annex-i",
      versionKey: "oj-2024-11-20",
      requirementKey: "part-i-1",
      rationale: "Applies to product.",
      productIds: [productId],
      ...mutation,
    };
    await controlsApi.updateMapping(controlId, key, mapping);
    await controlsApi.endMapping(controlId, key, mutation);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(
      fetcher.mock.calls.map(([path, init]) => [path, init.method]),
    ).toEqual([
      [`/api/v1/frameworks/controls/${controlId}`, "PUT"],
      [`/api/v1/frameworks/controls/${controlId}/archive`, "POST"],
      [`/api/v1/frameworks/controls/${controlId}/evidence-links`, "POST"],
      [
        `/api/v1/frameworks/controls/${controlId}/evidence-links/${key}`,
        "DELETE",
      ],
      [`/api/v1/frameworks/controls/${controlId}/mappings/${key}`, "PUT"],
      [`/api/v1/frameworks/controls/${controlId}/mappings/${key}`, "DELETE"],
    ]);
  });

  it("rejects malformed nested identifiers and stale-looking outgoing inputs", () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(() =>
      controlsApi.endEvidenceLink(controlId, "../bad", {
        expectedRevision: 1,
        idempotencyKey: key,
      }),
    ).toThrow("Invalid evidence link ID");
    expect(() =>
      controlsApi.endMapping(controlId, "../bad", {
        expectedRevision: 1,
        idempotencyKey: key,
      }),
    ).toThrow("Invalid mapping ID");
    expect(() => controlsApi.ownerCandidates("x".repeat(129))).toThrow(
      "The request contains invalid data",
    );
  });
});
