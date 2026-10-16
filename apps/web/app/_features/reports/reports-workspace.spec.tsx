// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import { storeReportDraftSeed } from "./report-draft";
import { ReportsWorkspace } from "./reports-workspace";

const id = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const definition = {
  id,
  ownerUserId: userId,
  definitionVersion: 1,
  version: 1,
  state: "draft",
  config: {
    title: "Registry report",
    report: {
      kind: "list",
      source: "products.registry",
      format: "csv",
      context: {},
      filters: {},
    },
    schedule: { frequency: "daily", timezone: "UTC", localTime: "09:00" },
    dateWindow: { kind: "fixed" },
    recipientUserIds: [userId],
    emailEnabled: false,
  },
  configDigest: "a".repeat(64),
  schemaVersion: "m14_04_v1",
  nextDueAt: null,
  previewRunId: null,
  pauseReason: null,
  createdAt: "2026-10-12T09:00:00.000Z",
  updatedAt: "2026-10-12T09:00:00.000Z",
} as const;
const run = {
  id: runId,
  definitionId: id,
  definitionVersion: 1,
  kind: "preview",
  state: "succeeded",
  scheduledFor: "2026-10-12T09:00:00.000Z",
  occurrenceKey: "preview:1",
  createdAt: "2026-10-12T09:00:00.000Z",
  finishedAt: "2026-10-12T09:00:10.000Z",
  safeErrorCode: null,
} as const;

const sessionState = vi.hoisted(() => ({
  value: {
    session: {
      organization: { id: "11111111-1111-4111-8111-111111111111" },
      user: { id: "22222222-2222-4222-8222-222222222222" },
    },
    isLoading: false,
  },
}));

vi.mock("../../_providers/session-provider", () => ({
  useSession: () => sessionState.value,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  sessionState.value = {
    session: { organization: { id }, user: { id: userId } },
    isLoading: false,
  };
});

describe("ReportsWorkspace", () => {
  it("uses the dashboard shell's existing main landmark", async () => {
    const gateway = {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      recipients: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      emailPreference: vi.fn().mockResolvedValue({ mode: "off", version: 1 }),
    };
    const view = render(
      <main>
        <ReportsWorkspace gateway={gateway as never} />
      </main>,
    );
    await screen.findByRole("heading", { name: "Scheduled reports" });
    expect(view.container.querySelectorAll("main")).toHaveLength(1);
  });
  it("keeps an edited draft and gives a conflict recovery action", async () => {
    const gateway = {
      list: vi
        .fn()
        .mockResolvedValue({ items: [definition], nextCursor: null }),
      recipients: vi
        .fn()
        .mockResolvedValue({ items: [{ id: userId, displayName: "Owner" }] }),
      emailPreference: vi.fn().mockResolvedValue({ mode: "off", version: 1 }),
      runs: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      get: vi.fn().mockResolvedValue({ data: { ...definition, version: 2 } }),
      update: vi
        .fn()
        .mockRejectedValue(new ApiClientError("api", "Conflict", 409)),
    };
    render(<ReportsWorkspace gateway={gateway as never} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Registry report" }),
    );
    await userEvent.clear(screen.getByLabelText("Report title"));
    await userEvent.type(
      screen.getByLabelText("Report title"),
      "My weekly report",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "changed in another session",
    );
    expect(screen.getByLabelText("Report title")).toHaveValue(
      "My weekly report",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh server version" }),
    );
    await waitFor(() => expect(gateway.get).toHaveBeenCalledWith(id));
    expect(screen.getByLabelText("Report title")).toHaveValue(
      "My weekly report",
    );
  });

  it("requires a successful preview before activation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(
      Date.parse("2026-10-12T10:00:00.000Z"),
    );
    const gateway = {
      list: vi
        .fn()
        .mockResolvedValue({ items: [definition], nextCursor: null }),
      recipients: vi
        .fn()
        .mockResolvedValue({ items: [{ id: userId, displayName: "Owner" }] }),
      emailPreference: vi.fn().mockResolvedValue({ mode: "off", version: 1 }),
      runs: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      preview: vi.fn().mockResolvedValue({
        run,
        recipients: [],
        recipientEligibility: [
          { userId, state: "eligible", safeErrorCode: null },
        ],
      }),
      get: vi
        .fn()
        .mockResolvedValue({ data: { ...definition, previewRunId: runId } }),
      activate: vi.fn().mockResolvedValue({
        data: {
          ...definition,
          state: "active",
          version: 2,
          previewRunId: runId,
        },
      }),
    };
    render(<ReportsWorkspace gateway={gateway as never} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Registry report" }),
    );
    expect(
      screen.getByRole("button", { name: "Activate schedule" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview report" }),
    );
    await waitFor(() => expect(gateway.preview).toHaveBeenCalled());
    expect(
      await screen.findByRole("heading", {
        name: "Preview recipient eligibility",
      }),
    ).toBeVisible();
    expect(screen.getByText(/Owner.*Eligible/)).toBeVisible();
    const activateButton = screen.getByRole("button", {
      name: "Activate schedule",
    });
    await waitFor(() => expect(activateButton).toBeEnabled());
    await userEvent.click(activateButton);
    await waitFor(() =>
      expect(gateway.activate).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ previewRunId: runId, expectedVersion: 1 }),
      ),
    );
    await userEvent.type(screen.getByLabelText("Report title"), " revised");
    expect(screen.getByLabelText("Report title")).toHaveValue(
      "Registry report revised",
    );
    expect(
      screen.queryByRole("heading", { name: "Preview recipient eligibility" }),
    ).not.toBeInTheDocument();
  });

  it("loads a bounded source selection, keeps a rejected new draft, and saves the corrected one", async () => {
    const seed = storeReportDraftSeed(
      {
        source: "products.registry",
        format: "csv",
        context: {},
        filters: { page: 2, pageSize: 25 },
      },
      `${id}:${userId}`,
    );
    history.replaceState(null, "", `/dashboard/reports?draft=${seed}`);
    const gateway = {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      recipients: vi
        .fn()
        .mockResolvedValue({ items: [{ id: userId, displayName: "Owner" }] }),
      emailPreference: vi.fn().mockResolvedValue({ mode: "off", version: 1 }),
      create: vi
        .fn()
        .mockRejectedValueOnce(new ApiClientError("api", "Schema changed", 422))
        .mockResolvedValue({ data: definition }),
    };
    render(<ReportsWorkspace gateway={gateway as never} />);
    expect(
      await screen.findByRole("heading", { name: "New schedule" }),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Report title"));
    await userEvent.type(screen.getByLabelText("Report title"), "My registry");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no longer supported",
    );
    expect(screen.getByLabelText("Report title")).toHaveValue("My registry");
    expect(gateway.create.mock.calls[0]![0].config.report.filters).toEqual({});
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(gateway.create).toHaveBeenCalledTimes(2));
    expect(gateway.create.mock.calls[0]![0].idempotencyKey).toBe(
      gateway.create.mock.calls[1]![0].idempotencyKey,
    );
    await waitFor(() => expect(location.search).toBe(""));
    expect(sessionStorage.length).toBe(0);
  });

  it("hides prior organization metadata immediately when the session scope changes", async () => {
    const gateway = {
      list: vi
        .fn()
        .mockResolvedValueOnce({ items: [definition], nextCursor: null })
        .mockResolvedValue({ items: [], nextCursor: null }),
      recipients: vi.fn().mockResolvedValue({ items: [] }),
      emailPreference: vi.fn().mockResolvedValue({ mode: "off", version: 1 }),
    };
    const view = render(<ReportsWorkspace gateway={gateway as never} />);
    expect(
      await screen.findByRole("button", { name: "Edit Registry report" }),
    ).toBeInTheDocument();
    sessionState.value = {
      session: {
        organization: { id: "44444444-4444-4444-8444-444444444444" },
        user: { id: userId },
      },
      isLoading: false,
    };
    view.rerender(<ReportsWorkspace gateway={gateway as never} />);
    expect(
      screen.queryByRole("button", { name: "Edit Registry report" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(2));
  });

  it("loads more recipient pages without losing selected members or the unsaved draft", async () => {
    const selectedFromAnotherPage = "55555555-5555-4555-8555-555555555555";
    const nextMember = "66666666-6666-4666-8666-666666666666";
    const gateway = {
      list: vi.fn().mockResolvedValue({
        items: [
          {
            ...definition,
            config: {
              ...definition.config,
              recipientUserIds: [userId, selectedFromAnotherPage],
            },
          },
        ],
        nextCursor: null,
      }),
      recipients: vi
        .fn()
        .mockResolvedValueOnce({
          items: [{ id: userId, displayName: "Owner" }],
          nextCursor: "22222222-2222-4222-8222-222222222222",
        })
        .mockResolvedValueOnce({
          items: [{ id: nextMember, displayName: "New member" }],
          nextCursor: null,
        }),
      emailPreference: vi.fn().mockResolvedValue({ mode: "off", version: 1 }),
      runs: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    render(<ReportsWorkspace gateway={gateway as never} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Registry report" }),
    );
    expect(
      screen.getByRole("checkbox", { name: /Selected member 55555555/ }),
    ).toBeChecked();
    await userEvent.clear(screen.getByLabelText("Report title"));
    await userEvent.type(
      screen.getByLabelText("Report title"),
      "Unsaved title",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Load more members" }),
    );
    expect(
      await screen.findByRole("checkbox", { name: "New member" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Selected member 55555555/ }),
    ).toBeChecked();
    expect(screen.getByLabelText("Report title")).toHaveValue("Unsaved title");
    expect(gateway.recipients).toHaveBeenLastCalledWith({
      cursor: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("pauses and archives a saved schedule and changes only the current user's email preference", async () => {
    const active = { ...definition, state: "active" as const };
    const gateway = {
      list: vi.fn().mockResolvedValue({ items: [active], nextCursor: null }),
      recipients: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      emailPreference: vi
        .fn()
        .mockResolvedValue({ mode: "immediate", version: 2 }),
      setEmailPreference: vi
        .fn()
        .mockResolvedValue({ mode: "off", version: 3 }),
      runs: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      pause: vi.fn().mockResolvedValue({
        data: { ...active, state: "paused", version: 2 },
      }),
      archive: vi.fn().mockResolvedValue({
        data: { ...active, state: "archived", version: 3 },
      }),
    };
    render(<ReportsWorkspace gateway={gateway as never} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Edit Registry report" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Pause schedule" }),
    );
    await waitFor(() =>
      expect(gateway.pause).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ expectedVersion: 1 }),
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Archive schedule" }),
    );
    await waitFor(() =>
      expect(gateway.archive).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ expectedVersion: 2 }),
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Turn off email" }),
    );
    await waitFor(() =>
      expect(gateway.setEmailPreference).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "off", expectedVersion: 2 }),
      ),
    );
    expect(screen.getByText("Email is off")).toBeInTheDocument();
  });
});
