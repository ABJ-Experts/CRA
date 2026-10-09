// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditGateway } from "./audit.api";
import {
  auditKeys,
  useAuditDetailQuery,
  useAuditDownloadGrantMutation,
  useAuditExportJobQuery,
  useAuditPageQuery,
  useAuditSearchMutation,
  useAuditVerifyMutation,
  useCreateAuditExportMutation,
} from "./audit.queries";

vi.mock("./audit.api", () => ({
  auditGateway: {
    search: vi.fn(),
    page: vi.fn(),
    detail: vi.fn(),
    verify: vi.fn(),
    createExport: vi.fn(),
    exportJob: vi.fn(),
    grantDownload: vi.fn(),
  },
}));

const jobId = "00000000-0000-4000-8000-000000000030";
const organizationId = "22222222-2222-4222-8222-222222222222";
const readyJob = {
  id: jobId,
  status: "ready",
  format: "csv",
  createdAt: "2026-01-02T00:00:00Z",
  expiresAt: "2026-01-02T00:15:00Z",
  rowCount: 1,
  packageHash: "a".repeat(64),
  failureCode: null,
} as const;

const queryClients: QueryClient[] = [];

function createQueryClient(
  options: ConstructorParameters<typeof QueryClient>[0] = {},
): QueryClient {
  const queryClient = new QueryClient({
    ...options,
    defaultOptions: {
      ...options.defaultOptions,
      queries: {
        retry: false,
        gcTime: Infinity,
        ...options.defaultOptions?.queries,
      },
      mutations: {
        retry: false,
        ...options.defaultOptions?.mutations,
      },
    },
  });
  queryClients.push(queryClient);
  return queryClient;
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("audit query hooks", () => {
  it("binds search, verify and export mutations to the gateway", async () => {
    const queryClient = createQueryClient();
    const searchInput = {
      requestId: "00000000-0000-4000-8000-000000000101",
      filters: {
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-31T00:00:00Z",
      },
    };
    const verifyInput = {
      requestId: "00000000-0000-4000-8000-000000000102",
      eventIds: ["00000000-0000-4000-8000-000000000002"],
    };
    const exportInput = {
      requestId: "00000000-0000-4000-8000-000000000103",
      snapshotToken: "snapshot_1",
      format: "csv" as const,
    };
    const { result } = renderHook(
      () => ({
        search: useAuditSearchMutation(),
        verify: useAuditVerifyMutation(),
        createExport: useCreateAuditExportMutation(),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await act(async () => {
      await result.current.search.mutateAsync(searchInput);
      await result.current.verify.mutateAsync({
        snapshotToken: "snapshot_1",
        input: verifyInput,
      });
      await result.current.createExport.mutateAsync(exportInput);
    });

    expect(auditGateway.search).toHaveBeenCalledWith(searchInput);
    expect(auditGateway.verify).toHaveBeenCalledWith("snapshot_1", verifyInput);
    expect(auditGateway.createExport).toHaveBeenCalledWith(exportInput);
  });

  it("binds page and detail reads to scoped keys and disables missing scopes", async () => {
    const queryClient = createQueryClient();
    const eventId = "00000000-0000-4000-8000-000000000002";
    const query = {
      requestId: "00000000-0000-4000-8000-000000000101",
      cursor: "cursor_1",
      limit: 25,
    };

    renderHook(
      () => ({
        page: useAuditPageQuery(organizationId, "snapshot_1", query, true),
        detail: useAuditDetailQuery(
          organizationId,
          "snapshot_1",
          eventId,
          "00000000-0000-4000-8000-000000000102",
          true,
        ),
        disabledPage: useAuditPageQuery(null, "snapshot_1", query, true),
        disabledDetail: useAuditDetailQuery(
          organizationId,
          null,
          eventId,
          "00000000-0000-4000-8000-000000000103",
          true,
        ),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(auditGateway.page).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(auditGateway.detail).toHaveBeenCalledTimes(1));
    expect(auditGateway.page).toHaveBeenCalledWith(
      "snapshot_1",
      query,
      expect.any(AbortSignal),
    );
    expect(auditGateway.detail).toHaveBeenCalledWith(
      "snapshot_1",
      eventId,
      "00000000-0000-4000-8000-000000000102",
      expect.any(AbortSignal),
    );
    expect(
      auditKeys.page(
        organizationId,
        "snapshot_1",
        "cursor_1",
        25,
        query.requestId,
      ),
    ).toEqual([
      "audit",
      organizationId,
      "page",
      "snapshot_1",
      "cursor_1",
      25,
      query.requestId,
    ]);
    expect(
      auditKeys.detail(organizationId, "snapshot_1", eventId, query.requestId),
    ).toEqual([
      "audit",
      organizationId,
      "detail",
      "snapshot_1",
      eventId,
      query.requestId,
    ]);
  });
  beforeEach(() => {
    let index = 0;
    const ids = [
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
      "00000000-0000-4000-8000-000000000103",
    ];
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => ids[index++] ?? ids.at(-1)),
    });
    vi.mocked(auditGateway.search).mockResolvedValue({
      snapshotToken: "snapshot_1",
      expiresAt: "2026-01-31T00:00:00Z",
      filters: { from: "2026-01-01T00:00:00Z", to: "2026-01-31T00:00:00Z" },
    });
    vi.mocked(auditGateway.page).mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    vi.mocked(auditGateway.detail).mockResolvedValue({
      event: {
        id: "00000000-0000-4000-8000-000000000002",
        sequence: "1",
        legacy: false,
        createdAt: "2026-01-02T00:00:00Z",
        actor: { id: null, type: "unknown", label: null },
        action: "product.updated",
        resourceType: "product",
        resourceId: null,
        correlationId: null,
        outcome: null,
        verificationStatus: "not_verified",
      },
      before: null,
      after: null,
      reason: null,
    });
    vi.mocked(auditGateway.verify).mockResolvedValue({
      checkedAt: "2026-01-02T00:00:00Z",
      items: [],
      completenessProven: false,
      authenticityProven: false,
    });
    vi.mocked(auditGateway.createExport).mockResolvedValue(readyJob);
    vi.mocked(auditGateway.exportJob).mockResolvedValue(readyJob);
    vi.mocked(auditGateway.grantDownload).mockResolvedValue({
      url: `/api/v1/audit/exports/${jobId}/download`,
      expiresAt: "2026-01-02T00:15:00Z",
      packageHash: "a".repeat(64),
    });
  });

  afterEach(async () => {
    cleanup();
    await Promise.all(queryClients.map((client) => client.cancelQueries()));
    for (const client of queryClients.splice(0)) client.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses a fresh audited request identity for each export status read", async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => useAuditExportJobQuery(organizationId, jobId, true),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() =>
      expect(auditGateway.exportJob).toHaveBeenCalledTimes(1),
    );
    await result.current.refetch();

    expect(auditGateway.exportJob).toHaveBeenNthCalledWith(
      1,
      jobId,
      "00000000-0000-4000-8000-000000000101",
      expect.any(AbortSignal),
    );
    expect(auditGateway.exportJob).toHaveBeenNthCalledWith(
      2,
      jobId,
      "00000000-0000-4000-8000-000000000102",
      expect.any(AbortSignal),
    );
  });

  it("publishes frozen keys with scoped and fallback values", () => {
    expect(auditKeys.all).toEqual(["audit"]);
    expect(auditKeys.snapshot(organizationId, "snapshot_1")).toEqual([
      "audit",
      organizationId,
      "snapshot",
      "snapshot_1",
    ]);
    expect(auditKeys.snapshot(null, null)).toEqual([
      "audit",
      "no-organization",
      "snapshot",
      "none",
    ]);
  });

  it("keeps export status disabled without organization or job scope", () => {
    const queryClient = createQueryClient();

    renderHook(() => useAuditExportJobQuery(null, jobId, true), {
      wrapper: createWrapper(queryClient),
    });
    renderHook(() => useAuditExportJobQuery(organizationId, null, true), {
      wrapper: createWrapper(queryClient),
    });

    expect(auditGateway.exportJob).not.toHaveBeenCalled();
    expect(auditKeys.exportJob(organizationId, jobId)).toEqual([
      "audit",
      organizationId,
      "export",
      jobId,
    ]);
  });

  it("throws before calling the gateway when a download grant has no job scope", async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useAuditDownloadGrantMutation(null), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      result.current.mutateAsync("00000000-0000-4000-8000-000000000101"),
    ).rejects.toThrow("Audit export job required.");
    expect(auditGateway.grantDownload).not.toHaveBeenCalled();
  });

  it("keeps defensive query errors for missing runtime scope", async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () => ({
        page: useAuditPageQuery(
          organizationId,
          null,
          { requestId: "00000000-0000-4000-8000-000000000101", limit: 25 },
          true,
        ),
        detail: useAuditDetailQuery(
          organizationId,
          "snapshot_1",
          null,
          "00000000-0000-4000-8000-000000000102",
          true,
        ),
        exportJob: useAuditExportJobQuery(organizationId, null, true),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await expect(result.current.page.refetch()).resolves.toMatchObject({
      error: expect.any(Error),
    });
    await expect(result.current.detail.refetch()).resolves.toMatchObject({
      error: expect.any(Error),
    });
    await expect(result.current.exportJob.refetch()).resolves.toMatchObject({
      error: expect.any(Error),
    });
  });

  it("keeps queued export jobs polling while terminal jobs stop", async () => {
    vi.mocked(auditGateway.exportJob).mockResolvedValueOnce({
      ...readyJob,
      status: "queued",
      packageHash: null,
      expiresAt: null,
      rowCount: null,
    });
    const queryClient = createQueryClient();

    renderHook(() => useAuditExportJobQuery(organizationId, jobId, true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(auditGateway.exportJob).toHaveBeenCalledTimes(1),
    );
  });

  it("submits download grant request identities through the scoped mutation", async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useAuditDownloadGrantMutation(jobId), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.mutateAsync("00000000-0000-4000-8000-000000000101");

    expect(auditGateway.grantDownload).toHaveBeenCalledWith(jobId, {
      requestId: "00000000-0000-4000-8000-000000000101",
    });
  });
});
