import { afterEach, describe, expect, it, vi } from "vitest";

import { riskRegisterApi } from "./risk-register.api";

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 });
}

describe("riskRegisterApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the product-scoped technical-file endpoint and parses an empty register", async () => {
    const fetcher = vi.fn(async () => json({ riskRegister: null }));
    vi.stubGlobal("fetch", fetcher);

    await expect(riskRegisterApi.get(PRODUCT_ID)).resolves.toEqual({
      riskRegister: null,
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/products/${PRODUCT_ID}/technical-file/risk-register`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });

  it("rejects malformed product identifiers before issuing a request", async () => {
    const fetcher = vi.fn(async () => json({ riskRegister: null }));
    vi.stubGlobal("fetch", fetcher);

    expect(() => riskRegisterApi.get("not-a-uuid")).toThrow(
      "The product identifier is invalid.",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
