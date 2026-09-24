/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";

const state = vi.hoisted(() => ({
  organizationId: "11111111-1111-4111-8111-111111111111" as string | null,
  sessionLoading: false,
  catalogLoading: false,
  catalogError: false,
  treeLoading: false,
  treeError: false,
  treeHasNextPage: false,
  refetchCatalog: vi.fn(),
  refetchTree: vi.fn(),
  fetchNextPage: vi.fn(),
  permissions: { can_view_frameworks: true, can_manage_frameworks: true },
  catalog: {
    packs: [
      {
        packKey: "cra",
        title: "Cyber Resilience Act",
        versions: [
          {
            versionKey: "oj-2024-11-20",
            editionDate: "2024-11-20",
            language: "en",
            sourceUrl: "https://eur-lex.europa.eu",
            sourceReference: "OJ L 2024/2847",
            attribution: "EUR-Lex",
            contentHash: "a".repeat(64),
          },
        ],
        selection: null as null | {
          versionKey: string;
          enabled: boolean;
          revision: number;
        },
      },
    ],
  },
  mutation: vi.fn().mockResolvedValue({
    packKey: "cra",
    versionKey: "oj-2024-11-20",
    enabled: true,
    revision: 1,
  }),
}));

vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: {
      organization: state.organizationId ? { id: state.organizationId } : null,
    },
    permissions: state.permissions,
    isLoading: state.sessionLoading,
  }),
}));
vi.mock("./frameworks.queries", () => ({
  useFrameworkCatalog: () => ({
    data: state.catalog,
    isLoading: state.catalogLoading,
    isError: state.catalogError,
    refetch: state.refetchCatalog,
  }),
  useFrameworkTree: () => ({
    data: {
      pages: [
        {
          requirements: [
            {
              requirementKey: "part-i-1",
              identifier: "I.1",
              parentKey: null,
              position: 1,
              depth: 0,
              heading: "Cybersecurity",
              text: "<script>alert(1)</script> legal text",
              sourceReference: "Annex I, Part I, 1",
            },
            {
              requirementKey: "part-i-2",
              identifier: "I.2",
              parentKey: null,
              position: 2,
              depth: 0,
              heading: "I.2",
              text: "This requirement starts with an exact source text excerpt and continues long enough to make a shortened preview useful while the complete wording remains available on expansion.",
              sourceReference: "Annex I, Part I, 2",
            },
          ],
          nextCursor: null,
        },
      ],
    },
    isLoading: state.treeLoading,
    isError: state.treeError,
    hasNextPage: state.treeHasNextPage,
    isFetchingNextPage: false,
    refetch: state.refetchTree,
    fetchNextPage: state.fetchNextPage,
  }),
  useSelectFramework: () => ({ mutateAsync: state.mutation, isPending: false }),
}));

import { FrameworksWorkspace } from "./frameworks-workspace";

const originalMocks = process.env.NEXT_PUBLIC_ENABLE_MOCKS;
afterEach(() => {
  cleanup();
  process.env.NEXT_PUBLIC_ENABLE_MOCKS = originalMocks;
  state.organizationId = "11111111-1111-4111-8111-111111111111";
  state.sessionLoading = false;
  state.catalogLoading = false;
  state.catalogError = false;
  state.treeLoading = false;
  state.treeError = false;
  state.treeHasNextPage = false;
  state.refetchCatalog.mockReset();
  state.refetchTree.mockReset();
  state.fetchNextPage.mockReset();
  state.catalog.packs[0]!.selection = null;
  state.permissions.can_view_frameworks = true;
  state.permissions.can_manage_frameworks = true;
  state.mutation.mockReset().mockResolvedValue({
    packKey: "cra",
    versionKey: "oj-2024-11-20",
    enabled: true,
    revision: 1,
  });
});

describe("FrameworksWorkspace", () => {
  it("shows a keyboard readable tree and renders legal text inertly", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    render(<FrameworksWorkspace />);
    expect(
      screen.getByRole("heading", { name: "Frameworks" }),
    ).toBeInTheDocument();
    const item = screen.getByRole("treeitem", { name: /I\.1 Cybersecurity/ });
    item.focus();
    fireEvent.keyDown(item, { key: "Enter" });
    fireEvent.click(item);
    expect(
      screen.getByText("<script>alert(1)</script> legal text"),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Read the authoritative source" }),
    ).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows a text preview instead of repeating a numbered heading", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    render(<FrameworksWorkspace />);
    const item = screen.getByRole("treeitem", {
      name: /I\.2 This requirement starts/i,
    });
    expect(item.textContent?.match(/I\.2/g)).toHaveLength(1);
    expect(item).toHaveTextContent(/…/);
    fireEvent.click(item);
    expect(
      screen.getByText(/complete wording remains available on expansion\./i),
    ).toBeInTheDocument();
  });

  it("saves an initial selection with null revision and preserves a failed draft", async () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.mutation.mockRejectedValueOnce(new Error("offline"));
    render(<FrameworksWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
    await waitFor(() =>
      expect(state.mutation).toHaveBeenCalledWith({
        packKey: "cra",
        input: expect.objectContaining({
          versionKey: "oj-2024-11-20",
          expectedRevision: null,
        }),
      }),
    );
    expect(screen.getByRole("combobox", { name: "Edition" })).toHaveValue(
      "oj-2024-11-20",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/retry/i);
  });

  it("denies rendering the catalog without read permission", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.permissions.can_view_frameworks = false;
    render(<FrameworksWorkspace />);
    expect(
      screen.getByText(/do not have permission to view/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("does not carry an unsaved selection into another organization", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    const view = render(<FrameworksWorkspace />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /show this edition/i }),
    );
    expect(
      screen.getByRole("checkbox", { name: /show this edition/i }),
    ).not.toBeChecked();
    state.organizationId = "22222222-2222-4222-8222-222222222222";
    view.rerender(<FrameworksWorkspace />);
    expect(
      screen.getByRole("checkbox", { name: /show this edition/i }),
    ).toBeChecked();
  });

  it("keeps a read-only user in a non-mutating preview", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.permissions.can_manage_frameworks = false;
    state.catalog.packs[0]!.selection = {
      versionKey: "oj-2024-11-20",
      enabled: false,
      revision: 2,
    };
    render(<FrameworksWorkspace />);
    expect(
      screen.getByText(/not currently enabled in the workspace/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save selection" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /show this edition/i }),
    ).toBeDisabled();
  });

  it("provides a catalog retry without offering stale content", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.catalogError = true;
    const saved = state.catalog.packs;
    state.catalog.packs = [];
    try {
      render(<FrameworksWorkspace />);
      expect(screen.getByRole("alert")).toHaveTextContent(
        /catalog could not be loaded/i,
      );
      fireEvent.click(screen.getByRole("button", { name: "Retry catalog" }));
      expect(state.refetchCatalog).toHaveBeenCalledOnce();
      expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    } finally {
      state.catalog.packs = saved;
    }
  });

  it("retries a failed tree and exposes pagination when more nodes exist", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.treeError = true;
    const view = render(<FrameworksWorkspace />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /requirements are unavailable/i,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry requirements" }));
    expect(state.refetchTree).toHaveBeenCalledOnce();
    state.treeError = false;
    state.treeHasNextPage = true;
    view.rerender(<FrameworksWorkspace />);
    fireEvent.click(
      screen.getByRole("button", { name: "Load more requirements" }),
    );
    expect(state.fetchNextPage).toHaveBeenCalledOnce();
    expect(
      screen.getByText(/more requirements are available/i),
    ).toBeInTheDocument();
  });

  it("shows session loading and a missing organization without a save command", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.sessionLoading = true;
    state.catalogLoading = true;
    const view = render(<FrameworksWorkspace />);
    expect(screen.getByText(/checking framework access/i)).toBeInTheDocument();
    expect(screen.getByText(/loading framework editions/i)).toBeInTheDocument();
    state.sessionLoading = false;
    state.organizationId = null;
    view.rerender(<FrameworksWorkspace />);
    expect(
      screen.getByText(/select an organization to view/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save selection" }),
    ).not.toBeInTheDocument();
  });

  it("shows the connection notice while mocks are active", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "true";
    render(<FrameworksWorkspace />);
    expect(
      screen.getByText(/framework packs are available when the CRA API/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("reuses an idempotency key when retrying an offline save", async () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.mutation.mockRejectedValueOnce(
      new ApiClientError("network", "Offline"),
    );
    render(<FrameworksWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /server is unreachable/i,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
    await waitFor(() => expect(state.mutation).toHaveBeenCalledTimes(2));
    expect(state.mutation.mock.calls[1]?.[0].input.idempotencyKey).toBe(
      state.mutation.mock.calls[0]?.[0].input.idempotencyKey,
    );
    expect(
      await screen.findByText("Framework selection saved."),
    ).toBeInTheDocument();
  });

  it.each([
    [403, "permission to change"],
    [400, "selection is invalid"],
  ])("preserves input on a %s save error", async (status, message) => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.mutation.mockRejectedValueOnce(
      new ApiClientError(
        status === 400 ? "invalid_request" : "api",
        "Rejected",
        status,
      ),
    );
    render(<FrameworksWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      new RegExp(message, "i"),
    );
    expect(screen.getByRole("combobox", { name: "Edition" })).toHaveValue(
      "oj-2024-11-20",
    );
  });

  it("refreshes after a stale revision and keeps the pending edition", async () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    state.catalog.packs[0]!.versions.push({
      ...state.catalog.packs[0]!.versions[0]!,
      versionKey: "later-edition",
      editionDate: "2025-01-01",
    });
    state.catalog.packs[0]!.selection = {
      versionKey: "oj-2024-11-20",
      enabled: true,
      revision: 1,
    };
    state.mutation.mockRejectedValueOnce(
      new ApiClientError("api", "Conflict", 409),
    );
    try {
      render(<FrameworksWorkspace />);
      fireEvent.change(screen.getByRole("combobox", { name: "Edition" }), {
        target: { value: "later-edition" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /changed in another session/i,
      );
      expect(state.refetchCatalog).toHaveBeenCalledOnce();
      expect(screen.getByRole("combobox", { name: "Edition" })).toHaveValue(
        "later-edition",
      );
      expect(state.mutation).toHaveBeenCalledWith({
        packKey: "cra",
        input: expect.objectContaining({
          expectedRevision: 1,
          versionKey: "later-edition",
        }),
      });
    } finally {
      state.catalog.packs[0]!.versions.pop();
    }
  });

  it("supports arrows, Home and End across the requirement tree", () => {
    process.env.NEXT_PUBLIC_ENABLE_MOCKS = "false";
    render(<FrameworksWorkspace />);
    const first = screen.getByRole("treeitem", { name: /I\.1 Cybersecurity/ });
    const second = screen.getByRole("treeitem", {
      name: /I\.2 This requirement/,
    });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(first).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(first).toHaveAttribute("aria-expanded", "false");
  });
});
