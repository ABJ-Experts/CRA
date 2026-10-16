// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookDeliveryPanel } from "./webhook-deliveries";
import {
  delivery,
  endpoint,
  preview,
  page,
} from "../../../_features/connectors/test/webhook-fixtures";
const api = vi.hoisted(() => ({ previewReplay: vi.fn(), replay: vi.fn() }));
vi.mock("../../../_features/connectors/webhooks.api", () => ({
  webhooksApi: api,
}));
const detail = { delivery, attempts: page([]) };
const run = async <T,>(action: () => Promise<T>) => action();
beforeEach(() => {
  api.previewReplay.mockResolvedValue({ preview });
  api.replay.mockResolvedValue({
    delivery: { ...delivery, id: "66666666-6666-4666-8666-666666666666" },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("reviewed webhook replay", () => {
  it("shows safe attempts and requires destination confirmation and reason before replay", async () => {
    const onReplayed = vi.fn();
    render(
      <WebhookDeliveryPanel
        detail={{
          delivery,
          attempts: page([
            {
              id: "a",
              deliveryRowId: delivery.id,
              attemptNumber: 1,
              leaseGeneration: 1,
              startedAt: delivery.createdAt,
              finishedAt: delivery.completedAt,
              outcome: "failed",
              httpStatus: 503,
              durationMs: 10,
              failureCategory: "receiver_unavailable",
              failureCode: "http_503",
              responseBytes: 0,
            },
          ]),
        }}
        endpoint={endpoint}
        canEdit
        pending={false}
        run={run}
        onReplayed={onReplayed}
      />,
    );
    expect(screen.getByText("receiver_unavailable")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview reviewed replay" }),
    );
    await screen.findByText("Review receiver and resource");
    const submit = screen.getByRole("button", {
      name: "Replay reviewed event",
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Replay reason"), {
      target: { value: "Receiver restored" },
    });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I confirm sending/));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(onReplayed).toHaveBeenCalledWith(
        "66666666-6666-4666-8666-666666666666",
      ),
    );
    expect(api.replay).toHaveBeenCalledWith(
      endpoint.id,
      delivery.id,
      expect.objectContaining({
        confirmDestinationChange: true,
        previewDigest: preview.previewDigest,
        reason: "Receiver restored",
      }),
    );
  });
  it("invalidates preview when endpoint or delivery changes and handles preview denial", async () => {
    const props = {
      detail,
      endpoint,
      canEdit: true,
      pending: false,
      run,
      onReplayed: vi.fn(),
    };
    const view = render(<WebhookDeliveryPanel {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Preview reviewed replay" }),
    );
    await screen.findByText("Review receiver and resource");
    view.rerender(
      <WebhookDeliveryPanel
        {...props}
        endpoint={{ ...endpoint, version: 2 }}
      />,
    );
    expect(
      screen.getByText(/Configuration or delivery changed/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Replay reviewed event" }),
    ).toBeDisabled();
    api.previewReplay.mockRejectedValue(new Error("revoked"));
    fireEvent.click(
      screen.getByRole("button", { name: "Preview reviewed replay" }),
    );
    await screen.findByText(/Replay preview is unavailable/);
    expect(
      screen.queryByText("Review receiver and resource"),
    ).not.toBeInTheDocument();
  });
  it("supports unchanged destination replay and retains intent after an uncertain failure", async () => {
    api.previewReplay.mockResolvedValue({
      preview: {
        ...preview,
        receiverChanged: false,
        previousHost: null,
        previousDestination: null,
      },
    });
    api.replay.mockRejectedValue(new Error("conflict"));
    render(
      <WebhookDeliveryPanel
        detail={detail}
        endpoint={endpoint}
        canEdit
        pending={false}
        run={run}
        onReplayed={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview reviewed replay" }),
    );
    await screen.findByText("Review receiver and resource");
    expect(screen.queryByLabelText(/I confirm/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Replay reason"), {
      target: { value: "Retry after restore" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Replay reviewed event" }),
    );
    await screen.findByText(/Replay outcome is unavailable/);
    expect(
      screen.getByText("Review receiver and resource"),
    ).toBeInTheDocument();
  });
  it("never offers replay without permission or for successful work and preserves unknown diagnostics", () => {
    render(
      <WebhookDeliveryPanel
        detail={{
          delivery: { ...delivery, status: "succeeded" },
          attempts: page([
            {
              id: "a",
              deliveryRowId: delivery.id,
              attemptNumber: 1,
              leaseGeneration: 1,
              startedAt: delivery.createdAt,
              finishedAt: null,
              outcome: "running",
              httpStatus: null,
              durationMs: null,
              failureCategory: null,
              failureCode: null,
              responseBytes: null,
            },
          ]),
        }}
        endpoint={endpoint}
        canEdit={false}
        pending={false}
        run={run}
        onReplayed={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Preview reviewed replay" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Unknown")).toHaveLength(2);
    expect(screen.getByText("None")).toBeInTheDocument();
  });
});

it("names the full destination when the path changes on the same host", async () => {
  api.previewReplay.mockResolvedValue({
    preview: {
      ...preview,
      currentHost: "receiver.example",
      previousHost: "receiver.example",
      currentDestination: "https://receiver.example/new-events",
      previousDestination: "https://receiver.example/old-events",
    },
  });
  render(
    <WebhookDeliveryPanel
      detail={detail}
      endpoint={endpoint}
      canEdit
      pending={false}
      run={run}
      onReplayed={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Preview reviewed replay" }),
  );
  await screen.findByText("Review receiver and resource");
  expect(
    screen.getByLabelText(
      /I confirm sending this event to the changed receiver https:\/\/receiver.example\/new-events/,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Previous receiver: https:\/\/receiver.example\/old-events/,
    ),
  ).toBeInTheDocument();
});

it("reuses the reviewed replay identity after an uncertain response and changes it only when intent changes", async () => {
  api.previewReplay.mockResolvedValue({
    preview: { ...preview, receiverChanged: false },
  });
  api.replay.mockRejectedValue(new Error("timeout after acknowledgement"));
  render(
    <WebhookDeliveryPanel
      detail={detail}
      endpoint={endpoint}
      canEdit
      pending={false}
      run={run}
      onReplayed={vi.fn()}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Preview reviewed replay" }),
  );
  await screen.findByText("Review receiver and resource");
  fireEvent.change(screen.getByLabelText("Replay reason"), {
    target: { value: "Receiver restored" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Replay reviewed event" }),
  );
  await waitFor(() => expect(api.replay).toHaveBeenCalledTimes(1));
  const key = api.replay.mock.calls[0]![2].idempotencyKey;
  expect(screen.getByText("Review receiver and resource")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Replay reviewed event" }),
  );
  await waitFor(() => expect(api.replay).toHaveBeenCalledTimes(2));
  expect(api.replay.mock.calls[1]![2].idempotencyKey).toBe(key);
  fireEvent.change(screen.getByLabelText("Replay reason"), {
    target: { value: "Reviewed recovery" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Replay reviewed event" }),
  );
  await waitFor(() => expect(api.replay).toHaveBeenCalledTimes(3));
  expect(api.replay.mock.calls[2]![2].idempotencyKey).not.toBe(key);
});
