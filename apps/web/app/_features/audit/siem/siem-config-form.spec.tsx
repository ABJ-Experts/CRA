// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiemConfigForm } from "./siem-config-form";
import { destination } from "./test/fixtures";
it("freezes the optimistic version when a public draft first changes", () => {
  const onSave = vi.fn();
  const view = render(
    <SiemConfigForm
      initial={destination}
      baseVersion={1}
      pending={false}
      onSave={onSave}
    />,
  );
  fireEvent.change(screen.getByLabelText("Destination name"), {
    target: { value: "Changed locally" },
  });
  view.rerender(
    <SiemConfigForm
      initial={destination}
      baseVersion={2}
      pending={false}
      onSave={onSave}
    />,
  );
  fireEvent.change(screen.getByLabelText("Configuration change reason"), {
    target: { value: "Reviewed recipient" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Changed locally" }),
    "Reviewed recipient",
    1,
  );
});
afterEach(cleanup);
it("preserves draft values and blocks edits while the command version refreshes", () => {
  const view = render(
    <SiemConfigForm
      initial={destination}
      baseVersion={1}
      pending={false}
      onSave={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Destination name"), {
    target: { value: "Retained draft" },
  });
  view.rerender(
    <SiemConfigForm
      initial={destination}
      baseVersion={2}
      pending
      onSave={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Destination name")).toHaveValue(
    "Retained draft",
  );
  expect(screen.getByLabelText("Destination name")).toBeDisabled();
  expect(screen.getByLabelText("Transport")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Save destination" }),
  ).toBeDisabled();
});
describe("SIEM configuration", () => {
  it("validates recipient and preserves public draft on failure", () => {
    const save = vi.fn();
    render(<SiemConfigForm onSave={save} pending={false} />);
    fireEvent.change(screen.getByLabelText("Destination name"), {
      target: { value: "Security collector" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByLabelText("Destination name")).toHaveValue(
      "Security collector",
    );
  });
});
it("saves explicit classes/product selection and typed transport", () => {
  const save = vi.fn();
  render(<SiemConfigForm onSave={save} pending={false} />);
  fireEvent.change(screen.getByLabelText("Destination name"), {
    target: { value: "Collector" },
  });
  fireEvent.change(screen.getByLabelText("Transport"), {
    target: { value: "syslog_tls" },
  });
  fireEvent.change(screen.getByLabelText("Format"), {
    target: { value: "cef" },
  });
  fireEvent.change(screen.getByLabelText("Collector endpoint"), {
    target: { value: "tls://collector.example.com:6514" },
  });
  fireEvent.click(screen.getByLabelText("products"));
  fireEvent.change(screen.getByLabelText("Authorized product IDs"), {
    target: { value: "11111111-1111-4111-8111-111111111111" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      transport: "syslog_tls",
      format: "cef",
      eventClasses: ["access_control", "products"],
    }),
    "",
  );
});
it("requires a reason for revised configuration and marks product scopes", () => {
  const save = vi.fn(),
    initial = {
      name: "Collector",
      endpoint: "https://collector.example.com",
      transport: "https" as const,
      format: "json" as const,
      eventClasses: ["products" as const],
      productIds: ["11111111-1111-4111-8111-111111111111"],
    };
  render(
    <SiemConfigForm
      initial={initial}
      catalogue={{
        version: 1,
        eventClasses: [
          { id: "products", label: "Products", productScoped: true },
        ],
        transports: ["https"],
        formats: ["json"],
      }}
      onSave={save}
      pending={false}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  expect(screen.getByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByLabelText("Products (product scoped)"));
  fireEvent.click(screen.getByLabelText("Products (product scoped)"));
  fireEvent.change(screen.getByLabelText("Configuration change reason"), {
    target: { value: "Reconfigure" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save destination" }));
  expect(save).toHaveBeenCalledWith(initial, "Reconfigure");
});
