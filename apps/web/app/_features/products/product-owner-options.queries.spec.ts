import { describe, expect, it, vi } from "vitest";
import { useProductOwnerOptionsQuery } from "./product-owner-options.queries";
const mocks = vi.hoisted(() => ({
  ownerOptions: vi.fn(),
  query: vi.fn(),
  organizationId: "tenant-a" as string | null,
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: {
      organization: mocks.organizationId ? { id: mocks.organizationId } : null,
    },
  }),
}));
vi.mock("./products.api", () => ({
  productsApi: { ownerOptions: mocks.ownerOptions },
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.query }));
describe("owner query", () => {
  it("isolates caches across tenant switches and disables unresolved identity", () => {
    mocks.organizationId = "tenant-a";
    useProductOwnerOptionsQuery(1, "");
    const a = mocks.query.mock.calls.at(-1)?.[0] as {
      queryKey: unknown[];
      enabled: boolean;
    };
    mocks.organizationId = "tenant-b";
    useProductOwnerOptionsQuery(1, "");
    const b = mocks.query.mock.calls.at(-1)?.[0] as {
      queryKey: unknown[];
      enabled: boolean;
    };
    expect(a.queryKey).not.toEqual(b.queryKey);
    expect(b.enabled).toBe(true);
    mocks.organizationId = null;
    useProductOwnerOptionsQuery(1, "");
    expect(mocks.query.mock.calls.at(-1)?.[0].enabled).toBe(false);
    mocks.organizationId = "tenant-a";
  });
  it("requests only the scoped product owner in label mode", () => {
    useProductOwnerOptionsQuery(1, "owner", "product");
    const options = mocks.query.mock.calls.at(-1)?.[0] as {
      queryFn: (context: { signal: AbortSignal }) => unknown;
    };
    const signal = new AbortController().signal;
    options.queryFn({ signal });
    expect(mocks.ownerOptions).toHaveBeenLastCalledWith(
      { page: 1, pageSize: 25, productId: "product" },
      signal,
    );
  });

  it.each(["", "11111111-1111-4111-8111-111111111111"])(
    "keys and scopes normalized owner query %s",
    (selectedOwnerId) => {
      useProductOwnerOptionsQuery(2, selectedOwnerId);
      const options = mocks.query.mock.calls.at(-1)?.[0] as {
        queryKey: unknown[];
        retry: boolean;
        queryFn: (context: { signal: AbortSignal }) => unknown;
      };
      expect(options.queryKey).toEqual([
        "products",
        "owner-options",
        mocks.organizationId,
        2,
        selectedOwnerId,
        null,
      ]);
      expect(options.retry).toBe(false);
      const signal = new AbortController().signal;
      options.queryFn({ signal });
      expect(mocks.ownerOptions).toHaveBeenLastCalledWith(
        {
          page: 2,
          pageSize: 25,
          ...(selectedOwnerId ? { selectedOwnerId } : {}),
        },
        signal,
      );
    },
  );
});
