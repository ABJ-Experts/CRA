// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookForm } from "./webhook-form";
afterEach(cleanup);
describe("WebhookForm", () => {
  it("starts disabled and does not offer credential entry to non-owners", () => {
    render(
      <WebhookForm
        canSubmitSecret={false}
        products={[]}
        eventTypes={[]}
        onSave={vi.fn()}
        pending={false}
      />,
    );
    expect(
      screen.getByText(/New endpoints start disabled/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Signing secret/)).not.toBeInTheDocument();
  });
  it("validates scope before dispatch and preserves the draft", () => {
    const save = vi.fn();
    render(
      <WebhookForm
        canSubmitSecret
        products={[]}
        eventTypes={[]}
        onSave={save}
        pending={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Receiver" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create disabled endpoint" }),
    );
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Display name")).toHaveValue("Receiver");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

import {
  endpoint,
  productId,
  secret,
} from "../../../_features/connectors/test/webhook-fixtures";
const product = { id: productId, name: "Sensor" };
const type = "product.release.lifecycle_changed" as const;
describe("WebhookForm configured flows", () => {
  it("creates a disabled endpoint with write-only secret and clears it after success", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <WebhookForm
        canSubmitSecret
        products={[product]}
        eventTypes={[type]}
        onSave={save}
        pending={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Receiver" },
    });
    fireEvent.change(screen.getByLabelText("HTTPS destination"), {
      target: { value: "https://receiver.example/events" },
    });
    fireEvent.click(screen.getByLabelText(type));
    fireEvent.click(screen.getByLabelText("Sensor"));
    fireEvent.change(screen.getByLabelText(/Signing secret/), {
      target: { value: secret },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create disabled endpoint" }),
    );
    await screen.findByText(/Configuration saved/);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        secretValue: secret,
        productIds: [productId],
        eventTypes: [type],
      }),
    );
    expect(screen.getByLabelText(/Signing secret/)).toHaveValue("");
  });
  it("validates selected products and retry bounds and allows removing selections", () => {
    const save = vi.fn();
    render(
      <WebhookForm
        endpoint={endpoint}
        canSubmitSecret
        products={[product]}
        eventTypes={[type]}
        onSave={save}
        pending={false}
      />,
    );
    fireEvent.click(screen.getByLabelText("Sensor"));
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Sensor"));
    fireEvent.click(screen.getByLabelText(type));
    fireEvent.click(screen.getByLabelText(type));
    fireEvent.change(screen.getByLabelText("Maximum attempts"), {
      target: { value: "11" },
    });
    fireEvent.change(screen.getByLabelText("Initial delay (seconds)"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("Maximum delay (seconds)"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    expect(save).not.toHaveBeenCalled();
  });
  it("preserves draft on failure and requires explicit reapply or discard after conflict", async () => {
    const save = vi.fn().mockRejectedValue(new Error("conflict"));
    const props = {
      endpoint,
      canSubmitSecret: false,
      products: [product],
      eventTypes: [type],
      onSave: save,
      pending: false,
    };
    const view = render(<WebhookForm {...props} />);
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Unsaved draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
    await screen.findByText(/Configuration outcome is unavailable/);
    expect(screen.getByLabelText("Display name")).toHaveValue("Unsaved draft");
    view.rerender(
      <WebhookForm
        {...props}
        endpoint={{ ...endpoint, version: 2, displayName: "Server name" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save configuration" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Reapply draft/ }));
    expect(screen.getByLabelText("Display name")).toHaveValue("Unsaved draft");
    view.rerender(
      <WebhookForm
        {...props}
        endpoint={{ ...endpoint, version: 3, displayName: "Latest server" }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Discard draft and load current" }),
    );
    expect(screen.getByLabelText("Display name")).toHaveValue("Latest server");
  });
  it("shows retained selections not on the current page and permits deselection", () => {
    render(
      <WebhookForm
        endpoint={endpoint}
        canSubmitSecret={false}
        products={[]}
        eventTypes={[type]}
        onSave={vi.fn()}
        pending={false}
      />,
    );
    fireEvent.click(screen.getByLabelText(`Selected product ${productId}`));
    expect(
      screen.queryByLabelText(`Selected product ${productId}`),
    ).not.toBeInTheDocument();
  });
});

it("reuses the command identity after an uncertain response and changes it only after editing", async () => {
  const save = vi.fn().mockRejectedValue(new Error("timeout"));
  render(
    <WebhookForm
      endpoint={endpoint}
      canSubmitSecret={false}
      products={[product]}
      eventTypes={[type]}
      onSave={save}
      pending={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
  await screen.findByText(/Configuration outcome is unavailable/);
  const key = save.mock.calls[0]![0].idempotencyKey;
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![0].idempotencyKey).toBe(key);
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Reviewed change" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  expect(save.mock.calls[2]![0].idempotencyKey).not.toBe(key);
});

it("protects submitted values while a request is pending", () => {
  render(
    <WebhookForm
      endpoint={endpoint}
      canSubmitSecret={false}
      products={[product]}
      eventTypes={[type]}
      onSave={vi.fn()}
      pending
    />,
  );
  expect(screen.getByLabelText("Display name")).toBeDisabled();
  expect(screen.getByLabelText("Sensor")).toBeDisabled();
});
