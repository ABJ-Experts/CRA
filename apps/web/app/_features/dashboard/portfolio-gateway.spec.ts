import { describe, expect, it, vi } from "vitest";
import { PortfolioGateway } from "./portfolio-gateway";

describe("PortfolioGateway", () => {
  it("uses parsed versioned GETs, response schemas and cancellation", async () => {
    const transport = vi.fn();
    const gateway = new PortfolioGateway(transport);
    const signal = new AbortController().signal;
    await gateway.products({}, signal);
    expect(transport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/api/v1/dashboard/portfolio/products?includeArchived=false&limit=20",
        schema: expect.any(Object),
        signal,
      }),
    );
    await gateway.concentration(
      { includeArchived: true, cursor: "opaque" },
      signal,
    );
    expect(transport.mock.calls[1]?.[0].path).toContain(
      "portfolio/concentration?",
    );
    expect(transport.mock.calls[1]?.[0].path).toContain("cursor=opaque");
    await gateway.detail({ componentRef: "opaque-reference" }, signal);
    expect(transport.mock.calls[2]?.[0].path).toContain(
      "portfolio/concentration/detail?",
    );
    expect(transport.mock.calls[2]?.[0].path).toContain(
      "componentRef=opaque-reference",
    );
  });
  it("rejects unknown fields, malformed scope, limits and empty refs before transport", () => {
    const transport = vi.fn();
    const gateway = new PortfolioGateway(transport);
    expect(() => gateway.products({ productId: "foreign" })).toThrow();
    expect(() => gateway.products({ limit: 101 })).toThrow();
    expect(() =>
      gateway.products({ organizationId: "forged" } as never),
    ).toThrow();
    expect(() => gateway.detail({ componentRef: "" })).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
