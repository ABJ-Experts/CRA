// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as hooks from "./sync-operations.queries";
import { connectorsApi } from "./connectors.api";
const state = vi.hoisted(() => ({ org: "tenant-a" }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({ session: { organization: { id: state.org } } }),
}));
vi.mock("./connectors.api", () => ({
  connectorsApi: Object.fromEntries(
    [
      "fieldMapSchema",
      "fieldMap",
      "previewFieldMap",
      "saveFieldMap",
      "syncHistory",
      "syncDetail",
      "deadLetterRecords",
      "previewReplay",
      "replay",
    ].map((method) => [method, vi.fn(async () => ({ run: { id: "child" } }))]),
  ),
}));
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.org = "tenant-a";
});
describe("sync operation organization boundaries", () => {
  it("scopes every query and retains no previous-tenant placeholders", async () => {
    const { client, wrapper } = setup();
    const { result, rerender } = renderHook(
      () => [
        hooks.useFieldMapSchemaQuery("connector", true),
        hooks.useFieldMapQuery("connector", true),
        hooks.useSyncHistoryQuery("connector", {}, true),
        hooks.useSyncDetailQuery("connector", "run", {}, true),
        hooks.useDeadLetterRecordsQuery("connector", {}, true),
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
        .every((query) => query.queryKey[1] === "tenant-a"),
    ).toBe(true);
    state.org = "tenant-b";
    rerender();
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .filter((query) => query.queryKey[1] === "tenant-b"),
      ).toHaveLength(5),
    );
  });
  it("uses current scope for previews and durable mutations and invalidates connector reads", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      () => ({
        preview: hooks.usePreviewFieldMapMutation("connector"),
        save: hooks.useSaveFieldMapMutation("connector"),
        replayPreview: hooks.usePreviewReplayMutation("connector", "run"),
        replay: hooks.useReplayMutation("connector", "run"),
      }),
      { wrapper },
    );
    const choices = {
      expectedVersion: 2,
      mappingMode: "preserve" as const,
      sourceMode: "retained" as const,
    };
    await act(async () => {
      await result.current.preview.mutateAsync({ fields: [] });
      await result.current.save.mutateAsync({
        expectedVersion: 2,
        expectedMappingRevision: 1,
        schemaDigest: "a".repeat(64),
        fields: [],
        idempotencyKey: crypto.randomUUID(),
      });
      await result.current.replayPreview.mutateAsync(choices);
      await result.current.replay.mutateAsync({
        ...choices,
        previewDigest: "a".repeat(64),
        reason: "Reviewed",
        idempotencyKey: crypto.randomUUID(),
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["connectors", "tenant-a", "connector"],
    });
    expect(connectorsApi.previewReplay).toHaveBeenCalledWith(
      "connector",
      "run",
      choices,
    );
  });
  it("rejects a late mutation response after switching organizations", async () => {
    const { wrapper } = setup();
    let finish!: () => void;
    vi.mocked(connectorsApi.replay).mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<typeof connectorsApi.replay>>>(
          (resolve) => {
            finish = () =>
              resolve({ run: { id: "old-tenant-child" } } as Awaited<
                ReturnType<typeof connectorsApi.replay>
              >);
          },
        ),
    );
    const { result, rerender } = renderHook(
      () => hooks.useReplayMutation("connector", "run"),
      { wrapper },
    );
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current
        .mutateAsync({
          expectedVersion: 2,
          mappingMode: "preserve",
          sourceMode: "retained",
          previewDigest: "a".repeat(64),
          reason: "Reviewed",
          idempotencyKey: crypto.randomUUID(),
        })
        .catch((error: Error) => error);
    });
    state.org = "tenant-b";
    rerender();
    await act(async () => finish());
    expect(await pending).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("Organization changed"),
      }),
    );
  });
});
