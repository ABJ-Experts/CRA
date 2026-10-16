import { describe, expect, it, vi } from "vitest";
import {
  useProductClassificationHistory,
  useProductClassifications,
} from "./product-classification.queries";
const mocks = vi.hoisted(() => ({
  org: "a" as string | null,
  query: vi.fn(),
  history: vi.fn(),
  latest: vi.fn(),
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: { organization: mocks.org ? { id: mocks.org } : null },
    permissions: { can_view_products: true },
  }),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query }));
vi.mock("./product-classification.api", () => ({
  productClassificationApi: { history: mocks.history, latest: mocks.latest },
}));
describe("classification queries", () => {
  it("partitions cache by resolved tenant and never retries automatically", () => {
    useProductClassificationHistory("p", 2);
    const a = mocks.query.mock.calls.at(-1)?.[0];
    mocks.org = "b";
    useProductClassificationHistory("p", 2);
    const b = mocks.query.mock.calls.at(-1)?.[0];
    expect(a.queryKey).not.toEqual(b.queryKey);
    expect(b.retry).toBe(false);
    b.queryFn({ signal: undefined });
    expect(mocks.history).toHaveBeenCalledWith(
      "p",
      { page: 2, pageSize: 15 },
      undefined,
    );
    mocks.org = null;
    useProductClassificationHistory("p", 1);
    expect(mocks.query.mock.calls.at(-1)?.[0].enabled).toBe(false);
  });
  it("uses one bounded bulk query and disables empty lists", () => {
    mocks.org = "a";
    useProductClassifications(["p"], true);
    const q = mocks.query.mock.calls.at(-1)?.[0];
    q.queryFn({ signal: undefined });
    expect(mocks.latest).toHaveBeenCalledWith(["p"], undefined);
    useProductClassifications([], true);
    expect(mocks.query.mock.calls.at(-1)?.[0].enabled).toBe(false);
    useProductClassifications(["p"], false);
    expect(mocks.query.mock.calls.at(-1)?.[0].enabled).toBe(false);
  });
});
