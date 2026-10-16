import { afterEach, describe, expect, it, vi } from "vitest";
import { productsApi } from "./products.api";
afterEach(() => vi.unstubAllGlobals());
const id = "11111111-1111-4111-8111-111111111111";
const response = {
  owners: {
    rows: [{ id, displayName: "Alice" }],
    total: 1,
    page: 1,
    pageSize: 25,
    pageCount: 1,
  },
  selectedOwner: { id, displayName: "Alice" },
};
describe("owner gateway", () => {
  it("parses incoming projection and sends only normalized query", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBeTruthy();
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await productsApi.ownerOptions({ selectedOwnerId: id })).toEqual(
      response,
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain(
      "/api/v1/products/owner-options?page=1&pageSize=25&selectedOwnerId=",
    );
  });
  it("rejects oversized outgoing query before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(productsApi.ownerOptions({ pageSize: 101 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed successful output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ owners: [] }), { status: 200 }),
      ),
    );
    await expect(productsApi.ownerOptions()).rejects.toThrow();
  });
});
