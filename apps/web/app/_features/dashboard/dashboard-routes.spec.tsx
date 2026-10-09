import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("Not found");
  },
}));
vi.mock("./dashboard-content", () => ({ DashboardContent: () => null }));
import DashboardPage from "../../dashboard/page";
import ProductPosturePage from "../../(workspace)/products/[productId]/posture/page";
describe("live dashboard routes", () => {
  it("renders live overview and validated product posture", async () => {
    expect(DashboardPage().props).toEqual({});
    const productId = "11111111-1111-4111-8111-111111111111";
    expect(
      (await ProductPosturePage({ params: Promise.resolve({ productId }) }))
        .props,
    ).toEqual({ productId });
  });
  it("rejects malformed product identities", async () => {
    await expect(
      ProductPosturePage({ params: Promise.resolve({ productId: "foreign" }) }),
    ).rejects.toThrow("Not found");
  });
});
