// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invitationsApi } from "./invitations.api";
import { invitationKeys } from "./invitations.keys";
import {
  invitationListQueryOptions,
  useCreateInvitationMutation,
  useInvitationListQuery,
  useResendInvitationMutation,
  useRevokeInvitationMutation,
} from "./invitations.queries";

vi.mock("./invitations.api", () => ({
  invitationsApi: {
    list: vi.fn(),
    create: vi.fn(),
    resend: vi.fn(),
    revoke: vi.fn(),
  },
}));

const CREATE_INPUT = {
  email: "team@example.com",
  role: "member",
} as const;
const INVITATION_ID = "a05570d6-aa75-4b6a-9688-b5a82eb3a774";

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("invitation query helpers", () => {
  afterEach(() => vi.clearAllMocks());

  it("publishes stable, frozen invitation query keys", () => {
    expect(invitationKeys).toEqual({
      all: ["invitations"],
      list: ["invitations", "list"],
    });
    expect(Object.isFrozen(invitationKeys)).toBe(true);
  });

  it("uses a non-retrying invitation list query", () => {
    expect(invitationListQueryOptions(false)).toMatchObject({
      queryKey: invitationKeys.list,
      enabled: false,
      retry: false,
    });
  });

  it("binds the list hook to the typed API client", async () => {
    vi.mocked(invitationsApi.list).mockResolvedValue({ rows: [] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useInvitationListQuery(true), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(invitationsApi.list).toHaveBeenCalledOnce());
  });

  it("invalidates invitation state after all invitation mutations", async () => {
    vi.mocked(invitationsApi.create).mockResolvedValue({ id: INVITATION_ID });
    vi.mocked(invitationsApi.resend).mockResolvedValue({
      id: INVITATION_ID,
      delivery: "confirmed",
    });
    vi.mocked(invitationsApi.revoke).mockResolvedValue({ ok: true });
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    let create: ReturnType<typeof useCreateInvitationMutation> | undefined;
    let resend: ReturnType<typeof useResendInvitationMutation> | undefined;
    let revoke: ReturnType<typeof useRevokeInvitationMutation> | undefined;

    function CaptureMutations() {
      create = useCreateInvitationMutation();
      resend = useResendInvitationMutation();
      revoke = useRevokeInvitationMutation();
      return null;
    }

    render(<CaptureMutations />, { wrapper: createWrapper(queryClient) });

    await act(async () => {
      await create?.mutateAsync(CREATE_INPUT);
      await resend?.mutateAsync(INVITATION_ID);
      await revoke?.mutateAsync(INVITATION_ID);
    });

    expect(invitationsApi.create).toHaveBeenCalledWith(CREATE_INPUT);
    expect(invitationsApi.resend).toHaveBeenCalledWith(INVITATION_ID);
    expect(invitationsApi.revoke).toHaveBeenCalledWith(INVITATION_ID);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: invitationKeys.all,
    });
  });
});
