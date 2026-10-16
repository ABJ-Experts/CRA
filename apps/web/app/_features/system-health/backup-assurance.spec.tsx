// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupAssurance } from "./backup-assurance";
import { ApiClientError } from "../../_lib/http/api-client";
const at = "2026-10-14T10:00:00.000Z";
const assurance = {
  status: "overdue" as const,
  lastAttempt: null,
  lastCapture: {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "capture" as const,
    state: "certified" as const,
    createdAt: at,
    completedAt: at,
    durationMs: 2000,
    integrity: "passed" as const,
    failureCode: null,
  },
  lastVerification: null,
  lastVerifiedRestoreAt: null,
  recoverablePointAt: at,
  verificationDueAt: at,
  residency: "eu",
  sourceAt: at,
  observedAt: at,
  reasons: ["verification_overdue" as const],
};
describe("customer recovery assurance", () => {
  afterEach(cleanup);
  it("keeps prior verified restore time visible when the latest drill fails", () => {
    render(
      <BackupAssurance
        organizationId="org"
        data={{
          ...assurance,
          status: "failed",
          lastVerifiedRestoreAt: at,
          lastVerification: {
            ...assurance.lastCapture,
            kind: "verification",
            state: "failed",
            integrity: "failed",
          },
          reasons: ["verification_failed"],
        }}
        gateway={{ history: vi.fn() }}
      />,
    );
    expect(
      screen
        .getByText("Last verified restore")
        .parentElement?.querySelector("time")?.dateTime,
    ).toBe(at);
    expect(
      screen.getByText("Latest restore test result").parentElement?.textContent,
    ).toContain("failed / failed");
    expect(
      screen.getByText("Assurance status").parentElement?.textContent,
    ).toContain("failed");
  });
  it("separates a successful capture from an overdue restore and shows bounded history", async () => {
    const history = vi
      .fn()
      .mockResolvedValue({ items: [assurance.lastCapture], nextCursor: null });
    render(
      <BackupAssurance
        organizationId="org"
        data={assurance}
        gateway={{ history }}
      />,
    );
    expect(
      screen.getByText("Assurance status").parentElement?.textContent,
    ).toContain("overdue");
    expect(
      screen.getByText("Last verified restore").parentElement?.textContent,
    ).toContain("Unknown");
    expect(
      screen.getByText("Capture integrity").parentElement?.textContent,
    ).toContain("passed");
    expect(history).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Show backup history" }),
    );
    expect(
      (
        await screen.findByRole("table", {
          name: "Organization backup assurance history",
        })
      ).textContent,
    ).toContain("certified");
  });
  it("uses safe retry errors and does not expose raw failure text", async () => {
    const history = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("api", "/mounted/secret", 403))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    render(
      <BackupAssurance
        organizationId="org"
        data={assurance}
        gateway={{ history }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show backup history" }),
    );
    expect((await screen.findByRole("alert")).textContent).not.toContain(
      "/mounted/",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry backup history" }),
    );
    await screen.findByText("No backup assurance events are available.");
  });
  it("paginates and resets sensitive history on organization changes", async () => {
    const history = vi.fn().mockResolvedValue({
      items: [{ ...assurance.lastCapture, failureCode: "object_missing" }],
      nextCursor: assurance.lastCapture.id,
    });
    const view = render(
      <BackupAssurance
        organizationId="one"
        data={{
          ...assurance,
          lastVerification: {
            ...assurance.lastCapture,
            kind: "verification",
            state: "verified",
          },
          reasons: [],
        }}
        gateway={{ history }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show backup history" }),
    );
    await screen.findByRole("table", {
      name: "Organization backup assurance history",
    });
    expect(screen.getByText("passed / object missing")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Next assurance page" }),
    );
    await screen.findByRole("button", { name: "First assurance page" });
    fireEvent.click(
      screen.getByRole("button", { name: "First assurance page" }),
    );
    await screen.findByRole("table", {
      name: "Organization backup assurance history",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Hide backup history" }),
    );
    expect(screen.queryByRole("table")).toBeNull();
    view.rerender(
      <BackupAssurance
        organizationId="two"
        data={{
          ...assurance,
          lastCapture: null,
          residency: null,
          recoverablePointAt: null,
          sourceAt: null,
        }}
        gateway={{ history }}
      />,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show backup history" }),
    ).toBeTruthy();
  });
  it("ignores aborted history results and failures", async () => {
    let finish!: (value: { items: []; nextCursor: null }) => void;
    const history = vi.fn().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <BackupAssurance
        organizationId="org"
        data={assurance}
        gateway={{ history }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show backup history" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Hide backup history" }),
    );
    finish({ items: [], nextCursor: null });
    expect(history.mock.calls[0]![2].aborted).toBe(true);
    view.unmount();
  });
});
