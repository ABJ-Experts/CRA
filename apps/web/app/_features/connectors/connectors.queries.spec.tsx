// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Connector } from "@repo/contracts/connectors/types";
import * as hooks from "./connectors.queries";
import { connectorKeys } from "./connectors.keys";
import { connectorsApi } from "./connectors.api";
const state = vi.hoisted(() => ({
  org: "org-a",
  response: {
    connector: {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      connectorType: "reference_conformance",
      displayName: "Reference fixture",
      adapterVersion: "1.0.0",
      mappingVersion: "v1",
      connectionConfig: {},
      archivedAt: null,
      hasSecret: false,
      commitPolicy: "manual",
      enabled: true,
      lastTestedAt: null,
      lastTestOutcome: null,
      lastTestErrorCode: null,
      version: 1,
      createdAt: "2026-09-28T10:00:00.000Z",
      updatedAt: "2026-09-28T10:00:00.000Z",
      createdBy: "33333333-3333-4333-8333-333333333333",
      updatedBy: "33333333-3333-4333-8333-333333333333",
    } satisfies Connector,
    run: { id: "run", status: "queued" },
  },
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({ session: { organization: { id: state.org } } }),
}));
vi.mock("./connectors.api", () => ({
  connectorsApi: Object.fromEntries(
    [
      "catalogue",
      "overviews",
      "overview",
      "list",
      "get",
      "getMapping",
      "listIdentities",
      "listSyncRuns",
      "getSyncRun",
      "listPlanItems",
      "listRunConflicts",
      "listDeadLetters",
      "getMetricsSnapshot",
      "create",
      "update",
      "setSecret",
      "test",
      "revokeSecret",
      "disconnect",
      "reconnect",
      "archive",
      "previewMapping",
      "saveMapping",
      "linkIdentity",
      "unlinkIdentity",
      "mergeIdentities",
      "startSyncRun",
      "requestCommit",
      "cancelSyncRun",
      "retrySyncRun",
      "resolveConflict",
      "exportDiagnostics",
    ].map((name) => [name, vi.fn(async () => state.response)]),
  ),
}));
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
  state.org = "org-a";
  state.response.run.status = "queued";
});

describe("connector tenant query boundaries", () => {
  it("scopes all feature query families to the selected organization", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () => [
        hooks.useConnectorCatalogueQuery(true),
        hooks.useConnectorOverviewsQuery({ page: 1 }, true),
        hooks.useConnectorOverviewQuery("connector", true),
        hooks.useConnectorsQuery({ page: 1 }, true),
        hooks.useConnectorQuery("connector", true),
        hooks.useConnectorMappingQuery("connector", true),
        hooks.useConnectorIdentitiesQuery("connector", {}, true),
        hooks.useConnectorSyncRunsQuery("connector", {}, true),
        hooks.useSyncRunQuery("connector", "run", true),
        hooks.usePlanItemsQuery("connector", "run", {}, true),
        hooks.useRunConflictsQuery("connector", "run", true),
        hooks.useConnectorDeadLettersQuery("connector", {}, true),
        hooks.useConnectorMetricsSnapshotQuery("connector", true),
      ],
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.every((query) => query.isSuccess)).toBe(true),
    );
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey[1] === "org-a"),
    ).toBe(true);
    state.response.run.status = "completed";
    await act(async () => {
      await result.current[8]!.refetch();
    });
    client.clear();
  });
  it("does not display prior-tenant list data during organization switch", async () => {
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(
      () => hooks.useConnectorsQuery({ page: 1, q: undefined }, true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    vi.mocked(connectorsApi.list).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    state.org = "org-b";
    rerender();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey[1]),
    ).toContain("org-b");
    client.clear();
  });
  it("keeps missing identifiers disabled", () => {
    const { client, wrapper } = setup();
    renderHook(
      () => [
        hooks.useConnectorQuery("", true),
        hooks.useSyncRunQuery("connector", "", true),
        hooks.usePlanItemsQuery("", "", {}, true),
      ],
      { wrapper },
    );
    expect(connectorsApi.get).not.toHaveBeenCalled();
    expect(connectorsApi.getSyncRun).not.toHaveBeenCalled();
    client.clear();
  });
});

describe("connector mutation cache and invalidation", () => {
  it("never stores credential plaintext in MutationCache", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () => hooks.useSetConnectorSecretMutation("connector"),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        expectedVersion: 1,
        idempotencyKey: "command",
        secretValue: "credential-canary",
      });
    });
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(
      "credential-canary",
    );
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    client.clear();
  });
  it("uses explicit commands and invalidates only the originating tenant", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      () => [
        hooks.useCreateConnectorMutation(),
        hooks.useUpdateConnectorMutation("connector"),
        hooks.useTestConnectorMutation("connector"),
        hooks.useRevokeConnectorSecretMutation("connector"),
        hooks.useDisconnectConnectorMutation("connector"),
        hooks.useReconnectConnectorMutation("connector"),
        hooks.useArchiveConnectorMutation("connector"),
        hooks.usePreviewMappingMutation("connector"),
        hooks.useSaveMappingMutation("connector"),
        hooks.useLinkIdentityMutation("connector"),
        hooks.useUnlinkIdentityMutation("connector"),
        hooks.useMergeIdentitiesMutation("connector"),
        hooks.useStartSyncRunMutation("connector"),
        hooks.useRequestCommitMutation("connector", "run"),
        hooks.useCancelSyncRunMutation("connector", "run"),
        hooks.useRetrySyncRunMutation("connector", "run"),
        hooks.useResolveConflictMutation("connector", "run"),
        hooks.useExportDiagnosticsMutation("connector"),
      ],
      { wrapper },
    );
    await act(async () => {
      for (const mutation of result.current)
        await mutation.mutateAsync({
          mappingId: "mapping",
          conflictId: "conflict",
          input: {},
        } as never);
    });
    expect(
      invalidate.mock.calls.every(
        ([options]) => options?.queryKey?.[1] === "org-a",
      ),
    ).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: connectorKeys.organization("org-a"),
    });
    client.clear();
  });
});

describe("late tenant actions", () => {
  it("does not publish an old tenant command after organization switch", async () => {
    const { client, wrapper } = setup();
    let finish!: (value: typeof state.response) => void;
    vi.mocked(connectorsApi.update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      () => hooks.useUpdateConnectorMutation("connector"),
      { wrapper },
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({} as never);
    });
    await waitFor(() => expect(connectorsApi.update).toHaveBeenCalledTimes(1));
    state.org = "org-b";
    rerender();
    finish(state.response);
    await expect(pending).rejects.toThrow(
      "Organization changed during the action",
    );
    client.clear();
  });
  it("does not keep secret mutation state or report success after a tenant switch", async () => {
    const { client, wrapper } = setup();
    let finish!: (value: typeof state.response) => void;
    vi.mocked(connectorsApi.setSecret).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      () => hooks.useSetConnectorSecretMutation("connector"),
      { wrapper },
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({
        expectedVersion: 1,
        idempotencyKey: "command",
        secretValue: "canary",
      });
    });
    state.org = "org-b";
    rerender();
    finish(state.response);
    await act(async () => {
      await expect(pending).rejects.toThrow(
        "Organization changed during credential submission",
      );
    });
    expect(result.current.isPending).toBe(false);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    client.clear();
  });
  it("rejects commands without a selected organization", async () => {
    state.org = "";
    const { client, wrapper } = setup();
    const { result } = renderHook(
      () => ({
        command: hooks.useUpdateConnectorMutation("connector"),
        secret: hooks.useSetConnectorSecretMutation("connector"),
      }),
      { wrapper },
    );
    await act(async () => {
      await expect(
        result.current.command.mutateAsync({} as never),
      ).rejects.toThrow("Organization changed");
      await expect(
        result.current.secret.mutateAsync({} as never),
      ).rejects.toThrow("Organization changed");
    });
    expect(connectorsApi.update).not.toHaveBeenCalled();
    expect(connectorsApi.setSecret).not.toHaveBeenCalled();
    client.clear();
  });
});
