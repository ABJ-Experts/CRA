/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  catalog: vi.fn(),
  tree: vi.fn(),
  select: vi.fn(),
}));
vi.mock("./frameworks.api", () => ({ frameworksApi: api }));

import {
  useFrameworkCatalog,
  useFrameworkTree,
  useSelectFramework,
} from "./frameworks.queries";

const version = {
  versionKey: "oj-2024-11-20",
  editionDate: "2024-11-20",
  language: "en",
  sourceUrl: "https://eur-lex.europa.eu",
  sourceReference: "CELEX:32024R2847",
  attribution: "EUR-Lex",
  contentHash: "a".repeat(64),
};
const catalog = (title: string) => ({
  packs: [
    { packKey: "cra-annex-i", title, versions: [version], selection: null },
  ],
});
const requirement = {
  requirementKey: "part-i",
  identifier: "Part I",
  parentKey: null,
  position: 1,
  depth: 0,
  heading: "Part I",
  text: "Exact legal text.",
  sourceReference: "Annex I Part I",
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("framework query boundary", () => {
  it("does not request data without an active organization or explicit access", () => {
    const { wrapper } = setup();
    renderHook(() => useFrameworkCatalog(null, true), { wrapper });
    renderHook(
      () => useFrameworkTree(null, "cra-annex-i", version.versionKey, true),
      { wrapper },
    );
    renderHook(() => useFrameworkCatalog("org-a", false), { wrapper });
    expect(api.catalog).not.toHaveBeenCalled();
    expect(api.tree).not.toHaveBeenCalled();
  });

  it("keeps catalog responses isolated when the selected organization changes", async () => {
    api.catalog
      .mockResolvedValueOnce(catalog("Organization A view"))
      .mockResolvedValueOnce(catalog("Organization B view"));
    const { wrapper } = setup();
    const view = renderHook(
      ({ organizationId }) => useFrameworkCatalog(organizationId, true),
      {
        initialProps: { organizationId: "org-a" },
        wrapper,
      },
    );
    await waitFor(() =>
      expect(view.result.current.data?.packs[0]?.title).toBe(
        "Organization A view",
      ),
    );
    view.rerender({ organizationId: "org-b" });
    await waitFor(() =>
      expect(view.result.current.data?.packs[0]?.title).toBe(
        "Organization B view",
      ),
    );
    expect(api.catalog).toHaveBeenCalledTimes(2);
  });

  it("loads bounded catalog pages and merges versions of a pack split across pages", async () => {
    api.catalog
      .mockResolvedValueOnce({
        ...catalog("Organization A view"),
        nextCursor: "MQ",
      })
      .mockResolvedValueOnce({
        packs: [
          {
            ...catalog("Organization A view").packs[0],
            versions: [{ ...version, versionKey: "v2" }],
          },
        ],
      });
    const { wrapper } = setup();
    const view = renderHook(() => useFrameworkCatalog("org-a", true), {
      wrapper,
    });
    await waitFor(() => expect(view.result.current.hasNextPage).toBe(true));
    await act(async () => {
      await view.result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(view.result.current.data?.packs[0]?.versions).toHaveLength(2),
    );
    expect(view.result.current.data?.packs).toHaveLength(1);
    expect(
      view.result.current.data?.packs[0]?.versions.map(
        (item) => item.versionKey,
      ),
    ).toEqual([version.versionKey, "v2"]);
    expect(view.result.current.hasNextPage).toBe(false);
    expect(api.catalog).toHaveBeenNthCalledWith(
      2,
      expect.any(AbortSignal),
      "MQ",
    );
  });

  it("uses the server cursor for bounded tree pages", async () => {
    api.tree
      .mockResolvedValueOnce({
        packKey: "cra-annex-i",
        versionKey: version.versionKey,
        editionDate: version.editionDate,
        requirements: [requirement],
        nextCursor: "MQ",
      })
      .mockResolvedValueOnce({
        packKey: "cra-annex-i",
        versionKey: version.versionKey,
        editionDate: version.editionDate,
        requirements: [
          { ...requirement, requirementKey: "part-ii", identifier: "Part II" },
        ],
        nextCursor: null,
      });
    const { wrapper } = setup();
    const view = renderHook(
      () => useFrameworkTree("org-a", "cra-annex-i", version.versionKey, true),
      { wrapper },
    );
    await waitFor(() => expect(view.result.current.hasNextPage).toBe(true));
    await act(async () => {
      await view.result.current.fetchNextPage();
    });
    await waitFor(() =>
      expect(view.result.current.data?.pages).toHaveLength(2),
    );
    expect(view.result.current.hasNextPage).toBe(false);
    expect(api.tree).toHaveBeenNthCalledWith(
      2,
      "cra-annex-i",
      version.versionKey,
      "MQ",
      expect.any(AbortSignal),
    );
  });

  it("updates only the active organization's catalog after a successful selection", async () => {
    api.select.mockResolvedValue({
      packKey: "cra-annex-i",
      versionKey: version.versionKey,
      enabled: true,
      revision: 1,
    });
    const { client, wrapper } = setup();
    client.setQueryData(["frameworks", "org-a", "catalog"], {
      pages: [catalog("A")],
      pageParams: [undefined],
    });
    client.setQueryData(["frameworks", "org-b", "catalog"], {
      pages: [catalog("B")],
      pageParams: [undefined],
    });
    const view = renderHook(() => useSelectFramework("org-a"), { wrapper });
    const input = {
      versionKey: version.versionKey,
      enabled: true,
      expectedRevision: null,
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    };
    await act(async () => {
      await view.result.current.mutateAsync({ packKey: "cra-annex-i", input });
    });
    expect(api.select).toHaveBeenCalledWith("cra-annex-i", input);
    expect(
      client.getQueryData<{
        pages: Array<{ packs: Array<{ selection: unknown }> }>;
      }>(["frameworks", "org-a", "catalog"])?.pages[0]?.packs[0]?.selection,
    ).toEqual({ versionKey: version.versionKey, enabled: true, revision: 1 });
    expect(
      client.getQueryData<{
        pages: Array<{ packs: Array<{ selection: unknown }> }>;
      }>(["frameworks", "org-b", "catalog"])?.pages[0]?.packs[0]?.selection,
    ).toBeNull();
  });
});
