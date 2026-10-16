// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpgradesWorkbench } from "./upgrades-workbench";
const id = "00000000-0000-4000-8000-000000000001";
const run = {
  id,
  instanceId: id,
  mediaId: id,
  version: 1,
  state: "awaiting-initiation",
  toVersion: "1.1.0",
  fromVersion: "1.0.0",
  result: null,
};
function fixture() {
  return {
    capabilities: vi.fn().mockResolvedValue({
      instanceId: id,
      enabled: true,
      actions: [
        "upgrades.view",
        "upgrades.stage",
        "upgrades.apply",
        "upgrades.rollback",
      ],
      currentVersion: "1.0.0",
      maintenance: false,
      version: 0,
    }),
    media: vi
      .fn()
      .mockResolvedValue({ items: [{ id, label: "release", bytes: 42 }] }),
    history: vi.fn().mockResolvedValue({ items: [run] }),
    stage: vi.fn().mockResolvedValue(run),
    preflight: vi.fn().mockResolvedValue({
      runId: id,
      version: 2,
      fingerprint: "a".repeat(64),
      eligible: true,
      summary: {
        fromVersion: "1.0.0",
        toVersion: "1.1.0",
        manifestDigest: "a".repeat(64),
        expectedOutageSeconds: 60,
        licenseEffects: ["unchanged"],
        rollback: "compatible-images-before-exposure",
        dataRestored: false,
        migrationsReversed: false,
      },
      expiresAt: "2099-01-01T00:00:00Z",
      checks: [{ code: "backup", status: "passed", detail: "verified" }],
    }),
    apply: vi.fn().mockResolvedValue({ ...run, state: "success" }),
    rollback: vi.fn().mockResolvedValue({ ...run, state: "rolled-back" }),
    reconcile: vi.fn().mockResolvedValue(run),
    result: vi.fn().mockResolvedValue({}),
    detail: vi.fn().mockResolvedValue(run),
  };
}
afterEach(cleanup);
it.each([
  { state: "success", exposurePossible: true },
  { state: "rollback-required", exposurePossible: true },
  { state: "rollback-required", exposurePossible: undefined },
])(
  "requires proven absence of exposure for rollback in $state ($exposurePossible)",
  async ({ state, exposurePossible }) => {
    const gateway = fixture();
    const exposed = {
      ...run,
      state,
      result: {
        outcome: state,
        exposurePossible,
        maintenanceRetained: state !== "success",
      },
    };
    gateway.history.mockResolvedValue({ items: [exposed] });
    gateway.detail.mockResolvedValue(exposed);
    render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
    fireEvent.click(
      await screen.findByRole("button", { name: `1.1.0: ${state}` }),
    );
    await waitFor(() => expect(gateway.detail).toHaveBeenCalledTimes(1));
    await screen.findByText("Recorded outcome:", { exact: false });
    expect(
      (
        screen.getByRole("button", {
          name: "Roll back compatible images",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(gateway.rollback).not.toHaveBeenCalled();
  },
);
describe("upgrade workbench", () => {
  it("requires mounted media and explicit fresh review before applying", async () => {
    const gateway = fixture();
    render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
    await screen.findByText("Current release:", { exact: false });
    expect(
      (
        screen.getByRole("button", {
          name: "Initiate reviewed upgrade",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Mounted signed release"), {
      target: { value: id },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and stage release" }),
    );
    await waitFor(() => expect(gateway.stage).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Run preflight checks",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Run preflight checks" }),
    );
    await screen.findByText("Preflight review");
    const expiry = document.querySelector(
      'time[dateTime="2099-01-01T00:00:00Z"]',
    );
    expect(expiry?.textContent).toBe(
      new Date("2099-01-01T00:00:00Z").toLocaleString(),
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Initiate reviewed upgrade" }),
    );
    await waitFor(() => expect(gateway.apply).toHaveBeenCalledTimes(1));
    expect(gateway.apply.mock.calls[0]?.[2]).toMatchObject({
      fingerprint: "a".repeat(64),
      acknowledgedEffects: true,
      expectedVersion: 2,
    });
  });
  it("preserves selection and invalidates review on transient status failure", async () => {
    const gateway = fixture();
    render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
    await screen.findByLabelText("Mounted signed release");
    fireEvent.change(screen.getByLabelText("Mounted signed release"), {
      target: { value: id },
    });
    gateway.capabilities.mockRejectedValueOnce(new Error());
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh upgrade status" }),
    );
    await screen.findByRole("alert");
    expect(
      (screen.getByLabelText("Mounted signed release") as HTMLSelectElement)
        .value,
    ).toBe(id);
    expect(
      (
        screen.getByRole("button", {
          name: "Verify and stage release",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("does not promote an unconfirmed action to success", async () => {
    const gateway = fixture();
    gateway.stage.mockRejectedValueOnce(new Error());
    render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
    await screen.findByLabelText("Mounted signed release");
    fireEvent.change(screen.getByLabelText("Mounted signed release"), {
      target: { value: id },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and stage release" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("not confirmed"),
    );
    expect(gateway.stage).toHaveBeenCalledTimes(1);
  });
  it("shows disabled control and no media states", async () => {
    const gateway = fixture();
    gateway.capabilities.mockResolvedValue({
      ...(await gateway.capabilities()),
      enabled: false,
      maintenance: true,
      currentVersion: null,
    });
    gateway.media.mockResolvedValue({ items: [] });
    gateway.history.mockResolvedValue({ items: [] });
    render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
    await screen.findByText("No mounted release media is available.");
    expect(
      screen.getByText("No upgrade runs have been recorded."),
    ).toBeTruthy();
  });
});
it("selects history, reconciles, rolls back and downloads redacted results", async () => {
  const gateway = fixture();
  const recovery = {
    ...run,
    state: "rollback-required",
    result: { outcome: "rollback-required", exposurePossible: false },
  };
  gateway.history.mockResolvedValue({
    items: [recovery],
  });
  gateway.detail.mockResolvedValue(recovery);
  const create = vi.fn().mockReturnValue("blob:result");
  Object.defineProperty(URL, "createObjectURL", {
    value: create,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "1.1.0: rollback-required" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Roll back compatible images",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Roll back compatible images" }),
  );
  await waitFor(() => expect(gateway.rollback).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Reconcile run" }));
  await waitFor(() => expect(gateway.reconcile).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Download redacted result",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Download redacted result" }),
  );
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
});
it("ignores late status after scope change", async () => {
  const gateway = fixture();
  let complete: (value: unknown) => void = () => {};
  gateway.capabilities.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const rendered = render(
    <UpgradesWorkbench instanceId={id} gateway={gateway as never} />,
  );
  rendered.rerender(
    <UpgradesWorkbench
      instanceId={id}
      authorityEpoch="revoked"
      gateway={gateway as never}
    />,
  );
  await screen.findByLabelText("Mounted signed release");
  complete({ enabled: false });
  await waitFor(() =>
    expect(
      screen.queryByText("Upgrade control disabled;", { exact: false }),
    ).toBeNull(),
  );
});
it("pages bounded history without losing selected review or draft on transient errors", async () => {
  const gateway = fixture();
  gateway.history.mockResolvedValue({ items: [run], nextCursor: id });
  render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
  await screen.findByLabelText("Mounted signed release");
  fireEvent.change(screen.getByLabelText("Mounted signed release"), {
    target: { value: id },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and stage release" }),
  );
  await waitFor(() => expect(gateway.stage).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Run preflight checks",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run preflight checks" }));
  await screen.findByText("Preflight review");
  fireEvent.click(screen.getByRole("checkbox"));
  gateway.history.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Next history page" }));
  await screen.findByText("History is unavailable.", { exact: false });
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(
    (screen.getByLabelText("Mounted signed release") as HTMLSelectElement)
      .value,
  ).toBe(id);
  gateway.history.mockResolvedValueOnce({ items: [], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "Retry history page" }));
  await screen.findByRole("button", { name: "First history page" });
  expect(gateway.history.mock.calls.at(-1)?.[2]).toEqual({
    limit: 25,
    cursor: id,
  });
  expect(screen.getByText("Preflight review")).toBeTruthy();
  gateway.history.mockResolvedValueOnce({ items: [run], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "First history page" }));
  await screen.findByRole("button", { name: "1.1.0: awaiting-initiation" });
  expect(gateway.history.mock.calls.at(-1)?.[2]).toEqual({ limit: 25 });
  expect(
    (
      screen.getByRole("button", {
        name: "Initiate reviewed upgrade",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});
it("resumes history from detail and refreshes asynchronous state truthfully", async () => {
  const gateway = fixture();
  gateway.detail.mockResolvedValueOnce({
    ...run,
    state: "activating",
    version: 2,
  });
  render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "1.1.0: awaiting-initiation" }),
  );
  await screen.findByText(`Run ${id}: activating.`, { exact: false });
  expect(gateway.detail).toHaveBeenCalledWith(id, id, expect.any(AbortSignal));
  gateway.detail.mockResolvedValueOnce({
    ...run,
    state: "rollback-required",
    version: 3,
    result: {
      outcome: "rollback-required",
      maintenanceRetained: true,
      exposurePossible: true,
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh upgrade status" }),
  );
  await screen.findByText("Recorded outcome: rollback-required.", {
    exact: false,
  });
  expect(
    screen.getByText("Maintenance retained.", { exact: false }),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Roll back compatible images",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("clears history, selection and review when instance authority changes", async () => {
  const gateway = fixture();
  gateway.history.mockResolvedValue({ items: [run], nextCursor: id });
  const rendered = render(
    <UpgradesWorkbench instanceId={id} gateway={gateway as never} />,
  );
  await screen.findByLabelText("Mounted signed release");
  fireEvent.change(screen.getByLabelText("Mounted signed release"), {
    target: { value: id },
  });
  gateway.history.mockResolvedValueOnce({ items: [], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "Next history page" }));
  await screen.findByRole("button", { name: "First history page" });
  rendered.rerender(
    <UpgradesWorkbench
      instanceId={id}
      authorityEpoch="r2"
      gateway={gateway as never}
    />,
  );
  await screen.findByLabelText("Mounted signed release");
  expect(
    screen.queryByRole("button", { name: "First history page" }),
  ).toBeNull();
  expect(
    (screen.getByLabelText("Mounted signed release") as HTMLSelectElement)
      .value,
  ).toBe("");
});
it("gives mounted media a concise accessible name", async () => {
  const gateway = fixture();
  render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
  expect(
    await screen.findByRole("combobox", {
      name: "Mounted signed release",
    }),
  ).toBeTruthy();
});
it("shows actionable guidance only for failed or unknown preflight checks", async () => {
  const gateway = fixture();
  gateway.preflight.mockResolvedValueOnce({
    ...(await gateway.preflight()),
    eligible: false,
    checks: [
      { code: "disk", status: "failed", detail: "blocked" },
      { code: "backup", status: "unknown", detail: "unavailable" },
      { code: "signature", status: "passed", detail: "verified" },
    ],
  });
  render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
  await screen.findByLabelText("Mounted signed release");
  fireEvent.change(screen.getByLabelText("Mounted signed release"), {
    target: { value: id },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and stage release" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Run preflight checks",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run preflight checks" }));
  expect(
    await screen.findByText("Free reviewed staging and image capacity", {
      exact: false,
    }),
  ).toBeTruthy();
  expect(
    screen.getByText("recent verified backup capture", { exact: false }),
  ).toBeTruthy();
  expect(
    screen.queryByText("trusted release signer", { exact: false }),
  ).toBeNull();
});
it("retains unchanged run approval on status refresh and repeat selection, but invalidates changed versions", async () => {
  const gateway = fixture();
  const approved = await gateway.preflight();
  gateway.detail.mockResolvedValue({
    ...run,
    version: approved.version,
    preflight: approved,
  });
  render(<UpgradesWorkbench instanceId={id} gateway={gateway as never} />);
  await screen.findByLabelText("Mounted signed release");
  fireEvent.change(screen.getByLabelText("Mounted signed release"), {
    target: { value: id },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and stage release" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Run preflight checks",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Run preflight checks" }));
  await screen.findByText("Preflight review");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh upgrade status" }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Initiate reviewed upgrade",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "1.1.0: awaiting-initiation" }),
  );
  await waitFor(() => expect(gateway.detail).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Initiate reviewed upgrade",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  gateway.detail.mockResolvedValueOnce({
    ...run,
    version: approved.version + 1,
    preflight: approved,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh upgrade status" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("Preflight review")).toBeNull(),
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Initiate reviewed upgrade",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
