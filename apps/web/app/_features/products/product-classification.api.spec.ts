import { afterEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_CLASSIFICATION_POLICY } from "@repo/contracts/products";
import { productClassificationApi } from "./product-classification.api";
const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
describe("classification gateway", () => {
  it("rejects invalid product path and oversized/duplicate list before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(productClassificationApi.history("foreign")).rejects.toThrow();
    await expect(productClassificationApi.latest([id, id])).rejects.toThrow();
    await expect(
      productClassificationApi.latest(Array(101).fill(id)),
    ).rejects.toThrow();
    await expect(
      productClassificationApi.history(id, { pageSize: 101 }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds and encodes list query without caller organization", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBeTruthy();
      return new Response(
        JSON.stringify({
          classifications: [{ productId: id, latest: null }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await productClassificationApi.latest([id])).toEqual({
      classifications: [{ productId: id, latest: null }],
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      `/api/v1/products/classifications?productIds=${id}`,
    );
  });
  it("rejects malformed success output for every read boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    await expect(productClassificationApi.policy()).rejects.toThrow();
    await expect(productClassificationApi.history(id)).rejects.toThrow();
    await expect(productClassificationApi.latest([id])).rejects.toThrow();
  });
  it("rejects outgoing save without valid branches and revision", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      productClassificationApi.save(id, {} as never),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends parsed save with exact revisions, never caller scope, and parses immutable run", async () => {
    const answers = {
      scope: "undetermined" as const,
      criticalCoreFunction: null,
      classIICoreFunction: null,
      classICoreFunction: null,
    };
    const input = {
      answers,
      rationale: " Reason ",
      expectedProductVersion: 2,
      expectedRevision: 0,
      policyVersion: PRODUCT_CLASSIFICATION_POLICY.version,
      policyHash: PRODUCT_CLASSIFICATION_POLICY.hash,
      idempotencyKey: id,
    };
    const run = {
      id,
      productId: id,
      revision: 1,
      productVersion: 2,
      classification: "undetermined",
      answers,
      rationale: "Reason",
      policySnapshot: PRODUCT_CLASSIFICATION_POLICY,
      policyHash: PRODUCT_CLASSIFICATION_POLICY.hash,
      createdBy: id,
      createdAt: "2026-09-28T00:00:00Z",
      supersedesId: null,
    };
    const fetcher = vi.fn(
      async (_path: RequestInfo | URL, options?: RequestInit) => {
        expect(_path).toContain(id);
        expect(JSON.parse(String(options?.body))).toEqual({
          ...input,
          rationale: "Reason",
        });
        return new Response(JSON.stringify({ run }), { status: 200 });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await productClassificationApi.save(id, input)).toEqual({ run });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      productClassificationApi.save(id, {
        ...input,
        organizationId: id,
      } as never),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
