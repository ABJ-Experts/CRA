/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { customFrameworksApi } from "./custom-frameworks.api";
import {
  useCustomFrameworkCommand,
  useCustomFrameworkDetail,
  useCustomFrameworks,
} from "./custom-frameworks.queries";

const organizationId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const content = {
  title: "Internal controls",
  editionDate: "2026-09-25",
  language: "en",
  attribution: "Internal policy",
  requirements: [
    {
      requirementKey: "control-1",
      identifier: "INT-1",
      parentKey: null,
      position: 1,
      heading: "Design review",
      text: "Document design control decisions.",
      sourceReference: "Policy 1",
    },
  ],
};

const item = {
  draftId,
  packKey: `custom.${draftId}`,
  title: content.title,
  status: "draft" as const,
  revision: 1,
  latestVersionKey: null,
  selectedVersionKey: null,
  contentHash: null,
  archivedAt: null,
  updatedAt: "2026-09-25T00:00:00Z",
};

function wrapper(client: QueryClient) {
  return function TestWrapper({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

afterEach(() => vi.restoreAllMocks());

describe("useCustomFrameworks", () => {
  it("does not list drafts without an organization or while disabled", async () => {
    const list = vi.spyOn(customFrameworksApi, "list").mockResolvedValue({
      items: [],
      nextOffset: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const disabled = renderHook(
      () => useCustomFrameworks(organizationId, false),
      {
        wrapper: wrapper(client),
      },
    );
    const missingOrganization = renderHook(
      () => useCustomFrameworks(null, true),
      {
        wrapper: wrapper(client),
      },
    );

    expect(disabled.result.current.fetchStatus).toBe("idle");
    expect(missingOrganization.result.current.fetchStatus).toBe("idle");
    expect(list).not.toHaveBeenCalled();
  });

  it("lists drafts for the active organization with a query signal", async () => {
    const list = vi.spyOn(customFrameworksApi, "list").mockResolvedValue({
      items: [],
      nextOffset: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(
      () => useCustomFrameworks(organizationId, true),
      {
        wrapper: wrapper(client),
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(list).toHaveBeenCalledWith(20, 0, expect.any(AbortSignal));
  });

  it("loads a requested page without reusing the first page cache", async () => {
    const list = vi.spyOn(customFrameworksApi, "list").mockResolvedValue({
      items: [],
      nextOffset: null,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result, rerender } = renderHook(
      ({ offset }) => useCustomFrameworks(organizationId, true, offset),
      { initialProps: { offset: 0 }, wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    rerender({ offset: 20 });
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(20, 20, expect.any(AbortSignal)),
    );
  });
});

describe("useCustomFrameworkDetail", () => {
  it("does not load detail without an organization, draft, or enabled flag", () => {
    const detail = vi.spyOn(customFrameworksApi, "detail").mockResolvedValue({
      ...item,
      content,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useCustomFrameworkDetail(organizationId, draftId, false), {
      wrapper: wrapper(client),
    });
    renderHook(() => useCustomFrameworkDetail(null, draftId, true), {
      wrapper: wrapper(client),
    });
    renderHook(() => useCustomFrameworkDetail(organizationId, null, true), {
      wrapper: wrapper(client),
    });

    expect(detail).not.toHaveBeenCalled();
  });

  it("loads selected draft detail with a query signal", async () => {
    const detail = vi.spyOn(customFrameworksApi, "detail").mockResolvedValue({
      ...item,
      content,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(
      () => useCustomFrameworkDetail(organizationId, draftId, true),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(detail).toHaveBeenCalledWith(draftId, expect.any(AbortSignal));
  });
});

describe("useCustomFrameworkCommand", () => {
  it("invalidates custom drafts, detail, and the framework catalog after a command", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.spyOn(customFrameworksApi, "command").mockResolvedValueOnce({
      draftId,
      packKey: `custom.${draftId}`,
      title: content.title,
      status: "published",
      revision: 2,
      latestVersionKey: "v1",
      selectedVersionKey: null,
      contentHash: "a".repeat(64),
      archivedAt: null,
      updatedAt: "2026-09-25T00:00:00Z",
    });

    const { result } = renderHook(
      () => useCustomFrameworkCommand(organizationId),
      {
        wrapper: wrapper(client),
      },
    );

    result.current.mutate({
      draftId,
      input: {
        action: "publish_version",
        expectedRevision: 1,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["frameworks", organizationId, "custom"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["frameworks", organizationId, "custom", draftId],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["frameworks", organizationId, "catalog"],
    });
  });

  it("does not invalidate tenant keys when the organization is absent", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.spyOn(customFrameworksApi, "command").mockResolvedValueOnce({
      draftId,
      packKey: `custom.${draftId}`,
      title: content.title,
      status: "draft",
      revision: 2,
      latestVersionKey: null,
      selectedVersionKey: null,
      contentHash: null,
      archivedAt: null,
      updatedAt: "2026-09-25T00:00:00Z",
    });

    const { result } = renderHook(() => useCustomFrameworkCommand(null), {
      wrapper: wrapper(client),
    });

    result.current.mutate({
      draftId: null,
      input: {
        action: "create_draft",
        content,
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
      },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
