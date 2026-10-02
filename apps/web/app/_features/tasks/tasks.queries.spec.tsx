// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useEligibleAssigneesQuery,
  useTaskAbsencesQuery,
  useTaskCommand,
  useTaskDetailQuery,
  useTaskGroupQuery,
  useTaskGroupsQuery,
  useTaskListQuery,
  useTaskMemberCandidatesQuery,
} from "./tasks.queries";

const state = vi.hoisted(() => ({ orgId: "org-one" as string | undefined }));
const api = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  eligible: vi.fn(),
  groups: vi.fn(),
  group: vi.fn(),
  absences: vi.fn(),
  memberCandidates: vi.fn(),
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({ session: { organization: { id: state.orgId } } }),
}));
vi.mock("./tasks.api", () => ({ tasksApi: api }));

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.orgId = "org-one";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.list.mockResolvedValue({
    rows: [],
    nextCursor: null,
    counts: { mine: 0, group: 0, available: 0 },
  });
  api.detail.mockResolvedValue({ task: {} });
  api.eligible.mockResolvedValue({ users: [], groups: [] });
  api.groups.mockResolvedValue({ groups: [] });
  api.group.mockResolvedValue({ group: {}, members: [] });
  api.absences.mockResolvedValue({ absences: [] });
  api.memberCandidates.mockResolvedValue({ users: [] });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

describe("task query boundaries", () => {
  it("loads selected task, eligible members, groups, and absences with scoped keys", async () => {
    const sourceId = "11111111-1111-4111-8111-111111111111";
    const groupId = "22222222-2222-4222-8222-222222222222";
    const hook = renderHook(
      () => ({
        detail: useTaskDetailQuery("finding_triage", sourceId),
        eligible: useEligibleAssigneesQuery("finding_triage", sourceId, true),
        groups: useTaskGroupsQuery(),
        group: useTaskGroupQuery(groupId),
        absences: useTaskAbsencesQuery(),
        candidates: useTaskMemberCandidatesQuery(),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(
        Object.values(hook.result.current).every((query) => query.isSuccess),
      ).toBe(true),
    );
    expect(api.detail).toHaveBeenCalledWith(
      "finding_triage",
      sourceId,
      expect.any(AbortSignal),
    );
    expect(api.eligible).toHaveBeenCalledWith(
      "finding_triage",
      sourceId,
      expect.any(AbortSignal),
    );
    expect(api.group).toHaveBeenCalledWith(groupId, expect.any(AbortSignal));
    expect(api.groups).toHaveBeenCalledTimes(1);
    expect(api.absences).toHaveBeenCalledTimes(1);
    expect(api.memberCandidates).toHaveBeenCalledTimes(1);
  });

  it("does not fetch task details or settings without scope and selection", () => {
    state.orgId = undefined;
    renderHook(
      () => ({
        detail: useTaskDetailQuery(null, null),
        eligible: useEligibleAssigneesQuery(null, null, false),
        groups: useTaskGroupsQuery(false),
        group: useTaskGroupQuery(null, false),
        absences: useTaskAbsencesQuery(false),
        candidates: useTaskMemberCandidatesQuery(false),
      }),
      { wrapper },
    );
    expect(
      Object.values(api).every((method) => method.mock.calls.length === 0),
    ).toBe(true);
  });

  it("does not fetch absent selections or disabled collections within an organization", () => {
    renderHook(
      () => ({
        list: useTaskListQuery({}, false),
        detail: useTaskDetailQuery(null, null),
        eligible: useEligibleAssigneesQuery(null, null, true),
        groups: useTaskGroupsQuery(false),
        group: useTaskGroupQuery(null, true),
        absences: useTaskAbsencesQuery(false),
        candidates: useTaskMemberCandidatesQuery(false),
      }),
      { wrapper },
    );
    expect(
      Object.values(api).every((method) => method.mock.calls.length === 0),
    ).toBe(true);
  });

  it("uses tenant-specific cache keys and does not show previous-tenant rows", async () => {
    const hook = renderHook(() => useTaskListQuery({ scope: "mine" }), {
      wrapper,
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey[1] === "org-one"),
    ).toBe(true);
    api.list.mockReturnValue(new Promise(() => {}));
    state.orgId = "org-two";
    hook.rerender();
    expect(hook.result.current.data).toBeUndefined();
    expect(
      client
        .getQueryCache()
        .getAll()
        .some((query) => query.queryKey[1] === "org-two"),
    ).toBe(true);
  });

  it("rejects a command whose response arrives after organization switch", async () => {
    const hook = renderHook(useTaskCommand, { wrapper });
    let resolve!: (value: string) => void;
    const request = new Promise<string>((done) => {
      resolve = done;
    });
    let result!: Promise<string>;
    act(() => {
      result = hook.result.current.run(() => request);
    });
    const rejected = expect(result).rejects.toThrow(
      "Organization changed during the action",
    );
    state.orgId = "org-two";
    hook.rerender();
    await act(async () => {
      resolve("stale");
    });
    await rejected;
    expect(client.getMutationCache().getAll()).toEqual([]);
  });

  it("invalidates current organization after success and conflict", async () => {
    const hook = renderHook(useTaskCommand, { wrapper });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => {
      await hook.result.current.run(async () => "saved");
    });
    const failure = new Error("conflict");
    await act(async () => {
      await expect(
        hook.result.current.run(async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tasks", "org-one"] });
    expect(invalidate).toHaveBeenCalledTimes(2);
    state.orgId = undefined;
    hook.rerender();
    await expect(
      hook.result.current.run(async () => "unexpected"),
    ).rejects.toThrow("Organization changed");
  });
});
