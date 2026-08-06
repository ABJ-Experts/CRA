import { describe, expect, it, vi } from "vitest";
import { browserApi, jsonRequest } from "./browser-api";

describe("browserApi", () => {
  it("sends mutations through the session proxy and returns JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "p-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserApi<{ id: string }>("/products", jsonRequest({ name: "Gateway" })),
    ).resolves.toEqual({ data: { id: "p-1" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/cras/products",
      expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" } }),
    );
  });

  it("preserves a problem-details correlation reference", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: "Insufficient permissions", correlationId: "corr-1" }),
            { status: 403 },
          ),
        ),
    );

    await expect(browserApi("/products")).resolves.toEqual({
      error: "Insufficient permissions (ref corr-1)",
    });
  });
});
