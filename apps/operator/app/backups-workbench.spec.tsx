// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupsWorkbench } from "./backups-workbench";
import { OperatorRequestError } from "./operator-gateway";
import { instanceId, observedAt } from "./operator.fixture";
import { backupCertified } from "./backups.fixture";
import { BackupsRuns } from "./backups-runs";

const configuration = {
  sourceAlias: "local-source",
  repositoryAlias: "off-host",
  stagingAlias: "private-ram",
  keyAlias: "backup-key-v1",
  targetProfile: "isolated-saas",
  residency: "eu",
  schedulingEnabled: false,
  checkpointIntervalMinutes: 30,
  baseIntervalHours: 24,
  verificationIntervalDays: 30,
  retentionDays: 30,
  pauseLimitSeconds: 120,
};
const policy = {
  instanceId,
  version: 1,
  configurationRevision: 1,
  configuration,
  approvedAt: observedAt,
  approvedBy: "operator",
  lastValidatedAt: observedAt,
};
const run = {
  id: instanceId,
  instanceId,
  kind: "capture",
  parentRunId: null,
  state: "queued",
  stage: "queued",
  progress: 0,
  version: 1,
  attempt: 0,
  configurationRevision: 1,
  createdAt: observedAt,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  failureCode: null,
  certificate: null,
  verification: null,
  cleanup: { state: "retained", deletedAt: null },
};
const validation = {
  valid: true,
  checkedAt: observedAt,
  configurationDigest: "a".repeat(64),
  checks: [{ code: "runtime_compatibility", status: "passed" }],
};
function gateway() {
  return {
    policy: vi.fn().mockResolvedValue(policy),
    history: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    validate: vi.fn().mockResolvedValue(validation),
    save: vi.fn().mockResolvedValue(policy),
    run: vi.fn().mockResolvedValue(run),
    detail: vi.fn().mockResolvedValue(run),
    cancel: vi.fn().mockResolvedValue({ ...run, state: "cancelled" }),
    verify: vi.fn().mockResolvedValue({
      ...run,
      kind: "verification",
      parentRunId: instanceId,
    }),
    cleanupReview: vi.fn().mockResolvedValue({
      runId: instanceId,
      version: 1,
      eligible: false,
      blockers: ["last_recoverable_chain"],
      reviewFingerprint: "a".repeat(64),
      reviewedAt: observedAt,
    }),
    cleanup: vi.fn().mockResolvedValue(run),
  };
}

describe("private encrypted backup workbench", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("loads safe policy and empty history and requires validation before approval", async () => {
    const api = gateway();
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await screen.findByLabelText("Source alias");
    expect(screen.getByText(/No backup runs/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Approve configuration",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Validate configuration" }),
    );
    await screen.findByText("runtime compatibility: passed");
    fireEvent.click(
      screen.getByRole("button", { name: "Approve configuration" }),
    );
    await waitFor(() => expect(api.save).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Repository alias"), {
      target: { value: "other-repository" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Approve configuration",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("shows safe authorization errors without raw tool details and permits retry", async () => {
    const api = gateway();
    api.policy.mockRejectedValueOnce(new OperatorRequestError(403));
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    expect((await screen.findByRole("alert")).textContent).toContain("grant");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry backup access" }),
    );
    await screen.findByLabelText("Source alias");
  });
  it("requests a capture and explicit cancellation using current versions", async () => {
    const api = gateway();
    api.history.mockResolvedValue({ items: [run], nextCursor: null } as never);
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    await screen.findByRole("table", { name: "Backup and restoration runs" });
    fireEvent.click(
      screen.getByRole("button", { name: "Run encrypted backup" }),
    );
    await waitFor(() =>
      expect(api.run).toHaveBeenCalledWith(
        instanceId,
        expect.objectContaining({ expectedVersion: 1 }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel capture" }));
    await waitFor(() =>
      expect(api.cancel).toHaveBeenCalledWith(
        instanceId,
        instanceId,
        expect.objectContaining({ expectedVersion: 1 }),
        expect.any(AbortSignal),
      ),
    );
  });
  it("shows retention blockers and never offers deletion without eligibility", async () => {
    const api = gateway();
    api.history.mockResolvedValue({
      items: [{ ...run, state: "failed", failureCode: "object_missing" }],
      nextCursor: null,
    } as never);
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    await screen.findByRole("table", { name: "Backup and restoration runs" });
    fireEvent.click(
      screen.getByRole("button", { name: "Review capture cleanup" }),
    );
    await screen.findByText("last recoverable chain");
    expect(
      screen.queryByRole("button", { name: "Confirm reviewed cleanup" }),
    ).toBeNull();
    expect(api.cleanup).not.toHaveBeenCalled();
  });
  it("requests isolated verification, reviewed eligible cleanup and bounded next page", async () => {
    const api = gateway();
    api.history.mockResolvedValue({
      items: [backupCertified],
      nextCursor: instanceId,
    } as never);
    api.cleanupReview.mockResolvedValue({
      runId: instanceId,
      version: 2,
      eligible: true,
      blockers: [],
      reviewFingerprint: "a".repeat(64),
      reviewedAt: observedAt,
    } as never);
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    await screen.findByRole("button", { name: "Verify clean restore" });
    fireEvent.click(
      screen.getByRole("button", { name: "Verify clean restore" }),
    );
    await waitFor(() =>
      expect(api.verify).toHaveBeenCalledWith(
        instanceId,
        instanceId,
        expect.objectContaining({ targetProfile: "isolated-saas" }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Review capture cleanup" }),
    );
    await screen.findByRole("button", { name: "Confirm reviewed cleanup" });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm reviewed cleanup" }),
    );
    await waitFor(() =>
      expect(api.cleanup).toHaveBeenCalledWith(
        instanceId,
        instanceId,
        expect.objectContaining({
          expectedVersion: 2,
          reviewFingerprint: "a".repeat(64),
        }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next backup page" }));
    await waitFor(() =>
      expect(api.history).toHaveBeenCalledWith(
        instanceId,
        { cursor: instanceId },
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "First backup page" }),
    );
    await waitFor(() =>
      expect(api.history).toHaveBeenLastCalledWith(
        instanceId,
        {},
        expect.any(AbortSignal),
      ),
    );
  });
  it.each([409, 503])(
    "preserves a draft on safe %s mutation failure and allows explicit refresh",
    async (status) => {
      const api = gateway();
      api.validate.mockRejectedValueOnce(new OperatorRequestError(status));
      render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
      await screen.findByLabelText("Source alias");
      fireEvent.change(screen.getByLabelText("Source alias"), {
        target: { value: "other-source" },
      });
      fireEvent.change(screen.getByLabelText("Retention days"), {
        target: { value: "60" },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(
        screen.getByRole("button", { name: "Validate configuration" }),
      );
      await screen.findByRole("alert");
      expect(
        (screen.getByLabelText("Source alias") as HTMLInputElement).value,
      ).toBe("other-source");
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh backup status" }),
      );
      await waitFor(() => expect(api.policy).toHaveBeenCalledTimes(2));
    },
  );
  it("clears instance drafts and ignores late results when switching or unmounting", async () => {
    const api = gateway();
    const view = render(
      <BackupsWorkbench instanceId={instanceId} gateway={api} />,
    );
    await screen.findByLabelText("Source alias");
    fireEvent.change(screen.getByLabelText("Source alias"), {
      target: { value: "private-draft" },
    });
    let finish!: (value: typeof policy) => void;
    api.policy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    view.rerender(
      <BackupsWorkbench
        instanceId="22222222-2222-4222-8222-222222222222"
        gateway={api}
      />,
    );
    expect(screen.queryByLabelText("Source alias")).toBeNull();
    view.unmount();
    finish(policy);
    expect(api.policy.mock.calls[0]![1].aborted).toBe(true);
  });
  it("starts unconfigured, guards duplicate actions and clears a newly revoked action", async () => {
    const api = gateway();
    api.policy.mockResolvedValue(null as never);
    const view = render(
      <BackupsWorkbench instanceId={instanceId} gateway={api} />,
    );
    await screen.findByLabelText("Source alias");
    expect(
      (
        screen.getByRole("button", {
          name: "Run encrypted backup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    view.unmount();
    const next = gateway();
    let reject!: (error: Error) => void;
    next.validate.mockImplementationOnce(
      () =>
        new Promise((_resolve, failure) => {
          reject = failure;
        }),
    );
    render(<BackupsWorkbench instanceId={instanceId} gateway={next} />);
    await screen.findByLabelText("Source alias");
    fireEvent.click(
      screen.getByRole("button", { name: "Validate configuration" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Validate configuration" }),
    );
    expect(next.validate).toHaveBeenCalledOnce();
    reject(new OperatorRequestError(403));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Source alias")).toBeNull();
  });
  it("explains pending executor validation and permits an explicit validation retry", async () => {
    const api = gateway();
    api.policy.mockResolvedValue(null as never);
    api.validate.mockResolvedValueOnce({
      ...validation,
      valid: false,
      checks: [{ code: "runtime_compatibility", status: "unavailable" }],
    } as never);
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    await screen.findByLabelText("Source alias");
    fireEvent.click(
      screen.getByRole("button", { name: "Validate configuration" }),
    );
    await screen.findByText("Runtime validation pending");
    expect(screen.getByText(/No backup has started/)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Approve configuration",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry validation" }));
    await screen.findByText("Configuration validation passed");
    expect(api.validate).toHaveBeenCalledTimes(2);
    expect(api.run).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });
  it("clears revoked drafts and validation before retrying authorized access", async () => {
    const api = gateway();
    api.validate.mockRejectedValueOnce(new OperatorRequestError(403));
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    await screen.findByLabelText("Source alias");
    fireEvent.change(screen.getByLabelText("Source alias"), {
      target: { value: "private-draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Validate configuration" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry backup access" }),
    );
    expect(
      ((await screen.findByLabelText("Source alias")) as HTMLInputElement)
        .value,
    ).toBe("local-source");
  });
  it.each(["read", "mutation"] as const)(
    "clears privileged state when %s returns scope-unavailable 404",
    async (operation) => {
      const api = gateway();
      api.history.mockResolvedValue({
        items: [run],
        nextCursor: null,
      } as never);
      render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
      await screen.findByLabelText("Source alias");
      fireEvent.change(screen.getByLabelText("Source alias"), {
        target: { value: "private-draft" },
      });
      if (operation === "read") {
        api.policy.mockRejectedValueOnce(new OperatorRequestError(404));
        fireEvent.click(
          screen.getByRole("button", { name: "Refresh backup status" }),
        );
      } else {
        api.validate.mockRejectedValueOnce(new OperatorRequestError(404));
        fireEvent.click(
          screen.getByRole("button", { name: "Validate configuration" }),
        );
      }
      await screen.findByRole("alert");
      expect(screen.queryByLabelText("Source alias")).toBeNull();
      expect(
        screen.queryByRole("table", { name: "Backup and restoration runs" }),
      ).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Retry backup access" }),
      );
      expect(
        ((await screen.findByLabelText("Source alias")) as HTMLInputElement)
          .value,
      ).toBe("local-source");
    },
  );
  it("ignores a pre-denial metadata response arriving after authority was cleared", async () => {
    const api = gateway();
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    await screen.findByLabelText("Source alias");
    fireEvent.change(screen.getByLabelText("Source alias"), {
      target: { value: "private-draft" },
    });
    let finish!: (value: typeof policy) => void;
    api.policy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh backup status" }),
    );
    await waitFor(() => expect(api.policy).toHaveBeenCalledTimes(2));
    api.validate.mockRejectedValueOnce(new OperatorRequestError(404));
    fireEvent.click(
      screen.getByRole("button", { name: "Validate configuration" }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Source alias")).toBeNull();
    const { act } = await import("@testing-library/react");
    await act(async () => finish(policy));
    expect(screen.queryByLabelText("Source alias")).toBeNull();
    expect(
      screen.queryByRole("table", { name: "Backup and restoration runs" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry backup access" }),
    );
    expect(
      ((await screen.findByLabelText("Source alias")) as HTMLInputElement)
        .value,
    ).toBe("local-source");
  });
  it("renders running and incomplete verification checks and retired tombstones", () => {
    const onAction = vi.fn();
    render(
      <BackupsRuns
        busy={false}
        review={null}
        onAction={onAction}
        items={[
          {
            ...run,
            state: "running",
            stage: "copying_objects",
            progress: 20,
          } as never,
          {
            ...run,
            id: "22222222-2222-4222-8222-222222222222",
            kind: "verification",
            parentRunId: instanceId,
            state: "incomplete",
            completedAt: observedAt,
            durationMs: 1200,
            verification: {
              integrity: "incomplete",
              checks: [{ code: "audit_continuity", status: "unavailable" }],
            },
            cleanup: { state: "deleted", deletedAt: observedAt },
          } as never,
        ]}
      />,
    );
    expect(
      screen.getByRole("progressbar", { name: "capture progress" }),
    ).toBeTruthy();
    expect(screen.getByText("audit continuity: unavailable")).toBeTruthy();
    expect(screen.getByText("Retired after reviewed cleanup")).toBeTruthy();
  });
  it("lets operators set bounded schedules and invalidates approval on a concurrent revision", async () => {
    const api = gateway();
    const interval = vi.spyOn(window, "setInterval");
    render(<BackupsWorkbench instanceId={instanceId} gateway={api} />);
    await screen.findByLabelText("Source alias");
    fireEvent.change(screen.getByLabelText("Checkpoint interval (minutes)"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText("Write pause maximum (seconds)"), {
      target: { value: "60" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Validate configuration" }),
    );
    await screen.findByText("Configuration validation passed");
    expect(api.validate).toHaveBeenCalledWith(
      instanceId,
      {
        configuration: expect.objectContaining({
          checkpointIntervalMinutes: 15,
          pauseLimitSeconds: 60,
        }),
      },
      expect.any(AbortSignal),
    );
    api.policy.mockResolvedValue({
      ...policy,
      version: 2,
      configurationRevision: 2,
    });
    const { act } = await import("@testing-library/react");
    act(() => (interval.mock.calls[0]![0] as () => void)());
    await screen.findByText("Backup configuration (revision 2)");
    expect(
      (
        screen.getByRole("button", {
          name: "Approve configuration",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByLabelText(
          "Checkpoint interval (minutes)",
        ) as HTMLInputElement
      ).value,
    ).toBe("15");
  });
});
