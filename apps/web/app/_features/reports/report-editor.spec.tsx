// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ReportConfiguration,
  ReportDefinition,
  ReportRun,
} from "@repo/contracts/reports";
import { ReportEditor } from "./report-editor";

const owner = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const config = {
  title: "Audit report",
  report: {
    kind: "list",
    source: "audit.events",
    format: "csv",
    context: {},
    filters: {},
  },
  schedule: { frequency: "daily", timezone: "UTC", localTime: "09:00" },
  dateWindow: { kind: "fixed" },
  recipientUserIds: [owner],
  emailEnabled: false,
} as ReportConfiguration;
const definition = {
  id: owner,
  version: 1,
  state: "active",
} as ReportDefinition;
const pendingPreview = {
  id: owner,
  kind: "preview",
  state: "running",
  createdAt: "2026-10-12T09:00:00.000Z",
  finishedAt: null,
  safeErrorCode: null,
} as ReportRun;
afterEach(cleanup);

it("edits recurrence, rolling dates, recipients and email as immutable drafts", async () => {
  const changes: ReportConfiguration[] = [];
  function Harness() {
    const [draft, setDraft] = useState(config);
    return (
      <ReportEditor
        config={draft}
        selected={null}
        preview={null}
        previewEligibility={[]}
        recipients={[
          { id: owner, displayName: "Owner" },
          { id: second, displayName: "Colleague" },
        ]}
        recipientNextCursor={null}
        loadingRecipients={false}
        busy={false}
        dirty={false}
        previewReady={false}
        onChange={(next) => {
          changes.push(next);
          setDraft(next);
        }}
        onSave={vi.fn()}
        onPreview={vi.fn()}
        onRefreshVersion={vi.fn()}
        onRefreshPreview={vi.fn()}
        onMutate={vi.fn()}
        onLoadMoreRecipients={vi.fn()}
      />
    );
  }
  render(<Harness />);
  await userEvent.selectOptions(screen.getByLabelText("Frequency"), "weekly");
  expect(screen.getByLabelText("Day of week")).toBeVisible();
  await userEvent.selectOptions(screen.getByLabelText("Day of week"), "2");
  await userEvent.selectOptions(screen.getByLabelText("Frequency"), "monthly");
  expect(changes.at(-1)?.schedule.frequency).toBe("monthly");
  await userEvent.clear(screen.getByLabelText(/Day of month/));
  await userEvent.type(screen.getByLabelText(/Day of month/), "31");
  await userEvent.selectOptions(screen.getByLabelText("Date window"), "30");
  await userEvent.click(screen.getByRole("checkbox", { name: "Colleague" }));
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: "Request email links for eligible recipients",
    }),
  );
  expect(changes.at(-1)).toMatchObject({
    schedule: { frequency: "monthly", monthDay: 31 },
    dateWindow: { kind: "rolling", days: 30 },
    recipientUserIds: [owner, second],
    emailEnabled: true,
  });
  expect(config.schedule.frequency).toBe("daily");
});

it("keeps lifecycle actions explicit and blocks activation until the preview is ready", async () => {
  const onMutate = vi.fn();
  const onRefreshPreview = vi.fn();
  const props = {
    config,
    recipients: [],
    recipientNextCursor: null,
    loadingRecipients: false,
    busy: false,
    dirty: false,
    previewReady: false,
    previewEligibility: [],
    onChange: vi.fn(),
    onSave: vi.fn(),
    onPreview: vi.fn(),
    onRefreshVersion: vi.fn(),
    onRefreshPreview,
    onMutate,
    onLoadMoreRecipients: vi.fn(),
  };
  const view = render(
    <ReportEditor {...props} selected={definition} preview={pendingPreview} />,
  );
  expect(
    screen.getByRole("button", { name: "Activate schedule" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh preview" }),
  );
  expect(onRefreshPreview).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Pause schedule" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Archive schedule" }),
  );
  expect(onMutate.mock.calls.map(([action]) => action)).toEqual([
    "pause",
    "archive",
  ]);
  view.rerender(
    <ReportEditor
      {...props}
      selected={{ ...definition, state: "paused" }}
      preview={{
        ...pendingPreview,
        state: "succeeded",
        finishedAt: "2026-10-12T09:01:00.000Z",
      }}
      previewReady
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Resume schedule" }),
  );
  expect(onMutate).toHaveBeenLastCalledWith("resume");
});

it("labels selected recipient eligibility from the preview without showing report contents", () => {
  render(
    <ReportEditor
      config={{ ...config, recipientUserIds: [owner, second] }}
      selected={{ ...definition, state: "draft" }}
      preview={{ ...pendingPreview, state: "succeeded" }}
      previewEligibility={[
        { userId: owner, state: "eligible", safeErrorCode: null },
        {
          userId: second,
          state: "ineligible",
          safeErrorCode: "source_access_denied",
        },
      ]}
      recipients={[
        { id: owner, displayName: "Owner" },
        { id: second, displayName: "Colleague" },
      ]}
      recipientNextCursor={null}
      loadingRecipients={false}
      busy={false}
      dirty={false}
      previewReady={true}
      onChange={vi.fn()}
      onSave={vi.fn()}
      onPreview={vi.fn()}
      onRefreshVersion={vi.fn()}
      onRefreshPreview={vi.fn()}
      onMutate={vi.fn()}
      onLoadMoreRecipients={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Preview recipient eligibility" }),
  ).toBeVisible();
  expect(screen.getByText(/Owner.*Eligible/)).toBeVisible();
  expect(
    screen.getByText(/Colleague.*Ineligible.*Source access denied/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Activate schedule" }),
  ).toBeEnabled();
  expect(screen.getByText(/Ineligible members will be skipped/)).toBeVisible();
});

it("blocks activation when every selected preview recipient is ineligible", () => {
  render(
    <ReportEditor
      config={config}
      selected={{ ...definition, state: "draft" }}
      preview={{ ...pendingPreview, state: "succeeded" }}
      previewEligibility={[
        {
          userId: owner,
          state: "ineligible",
          safeErrorCode: "membership_ineligible",
        },
      ]}
      recipients={[{ id: owner, displayName: "Owner" }]}
      recipientNextCursor={null}
      loadingRecipients={false}
      busy={false}
      dirty={false}
      previewReady
      onChange={vi.fn()}
      onSave={vi.fn()}
      onPreview={vi.fn()}
      onRefreshVersion={vi.fn()}
      onRefreshPreview={vi.fn()}
      onMutate={vi.fn()}
      onLoadMoreRecipients={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/Owner.*Ineligible.*Membership ineligible/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Activate schedule" }),
  ).toBeDisabled();
  expect(screen.getByText(/No selected recipient is eligible/)).toBeVisible();
});
