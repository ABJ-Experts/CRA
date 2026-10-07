// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuditSiemGateway } from "./siem.api";
import { delivery, id, deliveryId } from "./test/fixtures";
import { SiemHistory } from "./siem-history";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("does not label TLS syslog as confirmed receipt", () => {
  render(
    <SiemHistory
      items={[]}
      pending={false}
      canEdit={false}
      destinationId=""
      version={1}
      run={vi.fn()}
    />,
  );
  expect(screen.getByText(/does not confirm collector receipt/i)).toBeVisible();
  expect(screen.getByText(/no deliveries/i)).toBeVisible();
});
it("offers reviewed replay only for terminal uncertain or unsuccessful deliveries", () => {
  for (const state of [
    "accepted",
    "queued",
    "processing",
    "retrying",
  ] as const) {
    const view = render(
      <SiemHistory
        items={[{ ...delivery, state }]}
        pending={false}
        canEdit
        destinationId={id}
        version={1}
        run={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Review replay" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inspect delivery" }),
    ).toBeVisible();
    view.unmount();
  }
});
it("requires a reviewed current recipient before replay and shows bounded attempts", async () => {
  const run = vi.fn((command) => command().catch(() => undefined));
  vi.spyOn(AuditSiemGateway.prototype, "detail").mockResolvedValue({
    ...delivery,
    attempts: [
      {
        id,
        attempt: 1,
        state: "accepted",
        safeFailureCode: null,
        httpStatus: 204,
        startedAt: delivery.createdAt,
        finishedAt: delivery.updatedAt,
      },
    ],
  });
  vi.spyOn(AuditSiemGateway.prototype, "preview").mockResolvedValue({
    deliveryId,
    destinationId: id,
    expectedVersion: 1,
    endpoint: "https://collector.example.com/events",
    format: "json",
    transport: "https",
    event: delivery.event,
    previewDigest: "a".repeat(64),
    expiresAt: "2099-01-01T00:00:00Z",
  });
  const replay = vi
    .spyOn(AuditSiemGateway.prototype, "replay")
    .mockResolvedValue(delivery);
  render(
    <SiemHistory
      items={[delivery]}
      pending={false}
      canEdit
      destinationId={id}
      version={1}
      run={run}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Inspect delivery" }));
  await screen.findByText(/Attempt 1: accepted/);
  fireEvent.click(screen.getByRole("button", { name: "Close details" }));
  fireEvent.click(screen.getByRole("button", { name: "Review replay" }));
  await screen.findByText("Review the current recipient");
  expect(
    screen.getByRole("button", { name: "Queue reviewed replay" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Replay reason"), {
    target: { value: "Collector recovered" },
  });
  fireEvent.click(
    screen.getByLabelText("I reviewed this recipient and event."),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Queue reviewed replay" }),
  );
  await waitFor(() =>
    expect(replay).toHaveBeenCalledWith(
      id,
      deliveryId,
      expect.objectContaining({
        reason: "Collector recovered",
        confirmRecipient: true,
      }),
    ),
  );
  await screen.findByText(/Replay queued/);
});
it("allows cancelling replay review without mutation", async () => {
  vi.spyOn(AuditSiemGateway.prototype, "preview").mockResolvedValue({
    deliveryId,
    destinationId: id,
    expectedVersion: 1,
    endpoint: "https://collector.example.com/events",
    format: "cef",
    transport: "syslog_tls",
    event: delivery.event,
    previewDigest: "a".repeat(64),
    expiresAt: "2099-01-01T00:00:00Z",
  });
  render(
    <SiemHistory
      items={[{ ...delivery, safeFailureCode: null }]}
      pending={false}
      canEdit
      destinationId={id}
      version={1}
      run={async (command) => await command()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review replay" }));
  await screen.findByText("Review the current recipient");
  fireEvent.click(screen.getByRole("button", { name: "Cancel replay review" }));
  expect(screen.queryByLabelText("Replay reason")).not.toBeInTheDocument();
});
