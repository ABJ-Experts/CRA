// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import { ReportRunDetail } from "./report-run-detail";

const id = "11111111-1111-4111-8111-111111111111";
const mine = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const artifactId = "44444444-4444-4444-8444-444444444444";
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: { organization: { id }, user: { id: mine } },
    isLoading: false,
  }),
}));
afterEach(cleanup);

it("uses the dashboard shell's existing main landmark", async () => {
  const gateway = {
    run: vi
      .fn()
      .mockResolvedValue({
        run: {
          id,
          kind: "scheduled",
          state: "running",
          scheduledFor: null,
          safeErrorCode: null,
        },
        recipients: [],
      }),
  };
  const view = render(
    <main>
      <ReportRunDetail runId={id} gateway={gateway as never} />
    </main>,
  );
  await screen.findByRole("heading", { name: "Report run" });
  expect(view.container.querySelectorAll("main")).toHaveLength(1);
});

it("offers owner recovery when one recipient failed despite the run succeeding", async () => {
  const failed = {
    id: mine,
    userId: mine,
    generationState: "failed",
    emailState: "off",
    safeErrorCode: "render_failure",
    expiresAt: "2099-01-01T00:00:00.000Z",
    artifacts: [],
  };
  const ready = {
    id: other,
    userId: other,
    generationState: "ready",
    emailState: "accepted",
    safeErrorCode: null,
    expiresAt: "2099-01-01T00:00:00.000Z",
    artifacts: [{ id: artifactId, name: "ready.csv" }],
  };
  const run = {
    id,
    definitionId: other,
    definitionVersion: 1,
    kind: "scheduled",
    state: "succeeded",
    scheduledFor: "2026-10-12T09:00:00.000Z",
    safeErrorCode: null,
  };
  const gateway = {
    run: vi.fn().mockResolvedValue({ run, recipients: [failed, ready] }),
    get: vi
      .fn()
      .mockResolvedValue({
        data: {
          id: other,
          ownerUserId: mine,
          version: 4,
          definitionVersion: 1,
          state: "active",
        },
      }),
    replay: vi
      .fn()
      .mockResolvedValue({
        run: { ...run, state: "scheduled" },
        recipients: [{ ...failed, generationState: "waiting" }, ready],
      }),
  };
  render(<ReportRunDetail runId={id} gateway={gateway as never} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry failed generation" }),
  );
  expect(gateway.replay).toHaveBeenCalledWith(
    id,
    expect.objectContaining({
      expectedVersion: 4,
      idempotencyKey: expect.any(String),
    }),
  );
  expect(
    screen.queryByRole("button", { name: "Retry failed generation" }),
  ).not.toBeInTheDocument();
});

it("shows generation and delivery separately and never offers another member's artifact", async () => {
  const gateway = {
    run: vi.fn().mockResolvedValue({
      run: {
        id,
        definitionId: id,
        definitionVersion: 1,
        kind: "scheduled",
        state: "succeeded",
        scheduledFor: "2026-10-12T09:00:00.000Z",
        occurrenceKey: "slot",
        createdAt: "2026-10-12T09:00:00.000Z",
        finishedAt: "2026-10-12T09:01:00.000Z",
        safeErrorCode: null,
      },
      recipients: [
        {
          id: mine,
          userId: mine,
          generationState: "ready",
          emailState: "uncertain",
          safeErrorCode: "smtp_uncertain",
          expiresAt: "2099-10-13T09:00:00.000Z",
          artifacts: [
            {
              id: artifactId,
              name: "report.csv",
              mediaType: "text/csv",
              byteLength: 50,
              rowCount: 1,
              sha256: "a".repeat(64),
            },
          ],
        },
        {
          id: other,
          userId: other,
          generationState: "ready",
          emailState: "accepted",
          safeErrorCode: null,
          expiresAt: "2099-10-13T09:00:00.000Z",
          artifacts: [
            {
              id: other,
              name: "other.csv",
              mediaType: "text/csv",
              byteLength: 50,
              rowCount: 1,
              sha256: "b".repeat(64),
            },
          ],
        },
      ],
    }),
    grant: vi.fn().mockResolvedValue({
      data: {
        grantId: artifactId,
        url: `/api/v1/reports/runs/${id}/recipients/${mine}/download/${artifactId}`,
        expiresAt: "2026-10-12T09:05:00.000Z",
      },
    }),
  };
  render(<ReportRunDetail runId={id} gateway={gateway as never} />);
  expect(await screen.findByText(/Email: uncertain/)).toBeInTheDocument();
  expect(screen.getAllByText(/Generation: ready/)).toHaveLength(2);
  expect(screen.getByText(/Email acceptance is uncertain/)).toBeInTheDocument();
  expect(
    screen.getAllByRole("button", { name: "Prepare protected download" }),
  ).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Prepare protected download" }),
  );
  expect(
    await screen.findByRole("link", { name: "Open protected download" }),
  ).toHaveAttribute(
    "href",
    `/api/v1/reports/runs/${id}/recipients/${mine}/download/${artifactId}`,
  );
  expect(gateway.grant).toHaveBeenCalledWith(id, mine, artifactId);
});

it("shows an expired artifact without granting it and handles access denial on refresh", async () => {
  const gateway = {
    run: vi
      .fn()
      .mockResolvedValueOnce({
        run: {
          id,
          kind: "scheduled",
          state: "succeeded",
          scheduledFor: null,
          safeErrorCode: "source_changed",
        },
        recipients: [
          {
            id: mine,
            userId: mine,
            generationState: "ready",
            emailState: "failed",
            safeErrorCode: null,
            expiresAt: "2020-01-01T00:00:00.000Z",
            artifacts: [{ id: artifactId, name: "old.csv" }],
          },
        ],
      })
      .mockRejectedValueOnce(new ApiClientError("api", "Forbidden", 403)),
    grant: vi.fn(),
  };
  render(<ReportRunDetail runId={id} gateway={gateway as never} />);
  expect(
    await screen.findByText(/artifact availability window has expired/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Prepare protected download" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "access to this report changed",
  );
  expect(
    screen.queryByText(/artifact availability window has expired/),
  ).not.toBeInTheDocument();
  expect(gateway.grant).not.toHaveBeenCalled();
});

it("rejects a download grant whose URL does not match the exact scoped path", async () => {
  const gateway = {
    run: vi.fn().mockResolvedValue({
      run: {
        id,
        kind: "scheduled",
        state: "succeeded",
        scheduledFor: null,
        safeErrorCode: null,
      },
      recipients: [
        {
          id: mine,
          userId: mine,
          generationState: "ready",
          emailState: "off",
          safeErrorCode: null,
          expiresAt: "2099-01-01T00:00:00.000Z",
          artifacts: [{ id: artifactId, name: "current.csv" }],
        },
      ],
    }),
    grant: vi.fn().mockResolvedValue({
      data: {
        url: "https://other.example/file",
        grantId: artifactId,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    }),
  };
  render(<ReportRunDetail runId={id} gateway={gateway as never} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Prepare protected download" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "temporarily unavailable",
  );
  expect(
    screen.queryByRole("link", { name: "Open protected download" }),
  ).not.toBeInTheDocument();
});
