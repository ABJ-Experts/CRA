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

import { ApiClientError } from "../../_lib/http/api-client";
import { TechnicalFileSnapshots } from "./technical-file-snapshots";

const queries = vi.hoisted(() => ({
  useTechnicalFileSnapshotsQuery: vi.fn(),
  useTechnicalFileSnapshotExportQuery: vi.fn(),
  useCreateTechnicalFileSnapshotMutation: vi.fn(),
  useCreateTechnicalFileSnapshotExportMutation: vi.fn(),
  useCancelTechnicalFileSnapshotExportMutation: vi.fn(),
  useTechnicalFileSnapshotDownloadMutation: vi.fn(),
}));

vi.mock("./technical-files.queries", () => queries);
vi.mock("./technical-file-auditor-grants", () => ({
  TechnicalFileAuditorGrants: () => <div>Auditor sharing controls</div>,
}));

const snapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  productId: "33333333-3333-4333-8333-333333333333",
  technicalFileId: "44444444-4444-4444-8444-444444444444",
  technicalFileVersion: 3,
  releaseId: null,
  purpose: "audit",
  auditRationale: "Capture an audit-ready record.",
  templateKey: "annex_vii",
  templateVersion: "v1",
  readinessStatus: "partial",
  payload: {},
  payloadByteLength: 100,
  payloadSha256: "a".repeat(64),
  status: "current",
  supersededBySnapshotId: null,
  createdByUserId: "55555555-5555-4555-8555-555555555555",
  createdAt: "2026-09-14T00:00:00.000Z",
} as const;

const mutation = { mutateAsync: vi.fn(), isPending: false };

function prime(canSnapshot = true) {
  queries.useTechnicalFileSnapshotsQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: { snapshots: [snapshot] },
    refetch: vi.fn(),
  });
  queries.useTechnicalFileSnapshotExportQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: undefined,
  });
  queries.useCreateTechnicalFileSnapshotMutation.mockReturnValue(mutation);
  queries.useCreateTechnicalFileSnapshotExportMutation.mockReturnValue(
    mutation,
  );
  queries.useCancelTechnicalFileSnapshotExportMutation.mockReturnValue(
    mutation,
  );
  queries.useTechnicalFileSnapshotDownloadMutation.mockReturnValue(mutation);
  return canSnapshot;
}

beforeEach(() => {
  mutation.mutateAsync.mockReset();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TechnicalFileSnapshots", () => {
  it("presents immutable snapshot context and a constrained export action", () => {
    prime();
    render(
      <TechnicalFileSnapshots
        productId="33333333-3333-4333-8333-333333333333"
        technicalFileVersion={3}
        enabled
        canView
        canSnapshot
      />,
    );

    expect(screen.getByText("Technical-file snapshots")).toBeInTheDocument();
    expect(
      screen.getByText(/Capture an audit-ready record/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export snapshot" }),
    ).toBeEnabled();
  });

  it("keeps an audit rationale visible after local validation prevents creation", () => {
    prime();
    render(
      <TechnicalFileSnapshots
        productId="33333333-3333-4333-8333-333333333333"
        technicalFileVersion={3}
        enabled
        canView
        canSnapshot
      />,
    );

    fireEvent.change(screen.getByLabelText("Audit rationale"), {
      target: { value: "Preserve this rationale" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create snapshot" }));

    expect(screen.getByText(/audit rationale/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Audit rationale")).toHaveValue(
      "Preserve this rationale",
    );
  });

  it("keeps snapshot controls unavailable without the snapshot permission", () => {
    prime(false);
    render(
      <TechnicalFileSnapshots
        productId="33333333-3333-4333-8333-333333333333"
        technicalFileVersion={3}
        enabled
        canView
        canSnapshot={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Create snapshot" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Export snapshot" }),
    ).toBeNull();
    expect(screen.getByText("Technical-file snapshots")).toBeInTheDocument();
    expect(queries.useTechnicalFileSnapshotsQuery).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      true,
    );
  });

  it("does not offer a new export for a superseded immutable snapshot", () => {
    prime();
    queries.useTechnicalFileSnapshotsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        snapshots: [
          {
            ...snapshot,
            status: "superseded",
            supersededBySnapshotId: "66666666-6666-4666-8666-666666666666",
          },
        ],
      },
      refetch: vi.fn(),
    });
    render(
      <TechnicalFileSnapshots
        productId="33333333-3333-4333-8333-333333333333"
        technicalFileVersion={3}
        enabled
        canView
        canSnapshot
      />,
    );

    expect(
      screen.getByRole("button", { name: "Export snapshot" }),
    ).toBeDisabled();
    expect(screen.getByText(/cannot be exported again/)).toBeInTheDocument();
  });
});

it("focuses an exact known snapshot anchor when its history arrives without discarding edits", () => {
  prime();
  window.history.replaceState({}, "", `#snapshot-${snapshot.id}`);
  queries.useTechnicalFileSnapshotsQuery.mockReturnValue({
    isPending: true,
    isError: false,
    data: undefined,
  });
  const props = {
    productId: snapshot.productId,
    technicalFileVersion: 3,
    enabled: true,
    canView: true,
    canSnapshot: true,
  };
  const { rerender } = render(<TechnicalFileSnapshots {...props} />);
  fireEvent.change(screen.getByLabelText("Audit rationale"), {
    target: { value: "Keep my unsaved rationale" },
  });
  prime();
  rerender(<TechnicalFileSnapshots {...props} />);
  const row = document.getElementById(`snapshot-${snapshot.id}`);
  expect(row).not.toBeNull();
  expect(row).toHaveFocus();
  expect(screen.getByLabelText("Audit rationale")).toHaveValue(
    "Keep my unsaved rationale",
  );
  screen.getByLabelText("Audit rationale").focus();
  prime();
  rerender(<TechnicalFileSnapshots {...props} />);
  expect(screen.getByLabelText("Audit rationale")).toHaveFocus();
  window.history.replaceState({}, "", "/");
});
it("ignores unknown snapshot hashes and denied history without issuing extra reads", () => {
  prime();
  window.history.replaceState({}, "", "#snapshot-unknown");
  render(
    <TechnicalFileSnapshots
      productId={snapshot.productId}
      technicalFileVersion={3}
      enabled
      canView={false}
      canSnapshot={false}
    />,
  );
  expect(document.getElementById(`snapshot-${snapshot.id}`)).not.toHaveFocus();
  expect(queries.useTechnicalFileSnapshotsQuery).toHaveBeenLastCalledWith(
    snapshot.productId,
    false,
  );
  window.history.replaceState({}, "", "/");
});
it("focuses a loaded snapshot on explicit hash navigation with immediate reduced-motion-safe scrolling", () => {
  prime();
  window.history.replaceState({}, "", "/");
  render(
    <TechnicalFileSnapshots
      productId={snapshot.productId}
      technicalFileVersion={3}
      enabled
      canView
      canSnapshot
    />,
  );
  const row = document.getElementById(`snapshot-${snapshot.id}`);
  expect(row).not.toBeNull();
  const scroll = vi.fn();
  Object.defineProperty(row!, "scrollIntoView", { value: scroll });
  window.history.replaceState({}, "", `#snapshot-${snapshot.id}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(row).toHaveFocus();
  expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  window.history.replaceState({}, "", "/");
});

function renderSnapshots() {
  return render(
    <TechnicalFileSnapshots
      productId={snapshot.productId}
      technicalFileVersion={3}
      enabled
      canView
      canSnapshot
    />,
  );
}
async function startExport(
  status: string,
  extra: Record<string, unknown> = {},
) {
  prime();
  mutation.mutateAsync.mockResolvedValue({ export: { id: "export-id" } });
  queries.useTechnicalFileSnapshotExportQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: { export: { id: "export-id", status, ...extra } },
  });
  renderSnapshots();
  fireEvent.click(screen.getByRole("button", { name: "Export snapshot" }));
  await screen.findByText(/Export generation was queued/);
}
it("validates both snapshot purposes before requesting durable creation", async () => {
  prime();
  renderSnapshots();
  fireEvent.click(screen.getByRole("button", { name: "Create snapshot" }));
  expect(await screen.findByText(/Provide an audit rationale/)).toBeVisible();
  expect(mutation.mutateAsync).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Snapshot purpose"), {
    target: { value: "release" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create snapshot" }));
  expect(
    await screen.findByText(/Provide the active release ID/),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Active release ID"), {
    target: { value: "release-id" },
  });
  mutation.mutateAsync.mockResolvedValue({});
  fireEvent.click(screen.getByRole("button", { name: "Create snapshot" }));
  await screen.findByText(/Snapshot captured/);
  expect(mutation.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      purpose: "release",
      releaseId: "release-id",
      expectedTechnicalFileVersion: 3,
      idempotencyKey: expect.any(String),
    }),
  );
});
it.each([
  [403, "no longer have permission"],
  [409, "technical file changed"],
  [503, "temporarily unavailable"],
  [400, "Provider rejected"],
])("preserves audit input after source error %i", async (status, copy) => {
  prime();
  renderSnapshots();
  mutation.mutateAsync.mockRejectedValue(
    new ApiClientError("api", "Provider rejected", status),
  );
  fireEvent.change(screen.getByLabelText("Audit rationale"), {
    target: { value: "Keep rationale" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create snapshot" }));
  await screen.findByText(new RegExp(copy));
  expect(screen.getByLabelText("Audit rationale")).toHaveValue(
    "Keep rationale",
  );
});
it("offers snapshot-history retry and distinguishes genuinely empty history", () => {
  prime();
  const refetch = vi.fn();
  queries.useTechnicalFileSnapshotsQuery.mockReturnValue({
    isPending: false,
    isError: true,
    refetch,
  });
  const { rerender } = renderSnapshots();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalled();
  queries.useTechnicalFileSnapshotsQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: { snapshots: [] },
  });
  rerender(
    <TechnicalFileSnapshots
      productId={snapshot.productId}
      technicalFileVersion={3}
      enabled
      canView
      canSnapshot
    />,
  );
  expect(screen.getByText(/No snapshots have been captured/)).toBeVisible();
});
it("reports export request failure without corrupting the immutable snapshot", async () => {
  prime();
  mutation.mutateAsync.mockRejectedValue(new Error("private error"));
  renderSnapshots();
  fireEvent.click(screen.getByRole("button", { name: "Export snapshot" }));
  expect(
    await screen.findByText("The snapshot export could not be requested."),
  ).toBeVisible();
  expect(
    document.getElementById(`snapshot-${snapshot.id}`),
  ).toBeInTheDocument();
});
it("exposes queued export cancellation with required reason and durable command", async () => {
  await startExport("queued");
  fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
  await screen.findByText(/Provide a cancellation reason/);
  fireEvent.change(screen.getByLabelText("Cancellation reason"), {
    target: { value: "Superseded by release review" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
  await screen.findByText(/export was cancelled/);
  expect(mutation.mutateAsync).toHaveBeenLastCalledWith(
    expect.objectContaining({
      reason: "Superseded by release review",
      idempotencyKey: expect.any(String),
    }),
  );
});
it("preserves cancellation reason on failed command", async () => {
  await startExport("generating");
  mutation.mutateAsync.mockRejectedValue(new Error("private"));
  fireEvent.change(screen.getByLabelText("Cancellation reason"), {
    target: { value: "Keep cancel reason" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
  await screen.findByText("The export could not be cancelled.");
  expect(screen.getByLabelText("Cancellation reason")).toHaveValue(
    "Keep cancel reason",
  );
});
it("downloads only authorized ready artifacts and handles grant failure", async () => {
  await startExport("ready");
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  mutation.mutateAsync.mockResolvedValue({
    download: { downloadUrl: "/authorized-artifact" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      "/authorized-artifact",
      "_blank",
      "noopener,noreferrer",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Download archive" }));
  await waitFor(() =>
    expect(mutation.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ artifact: "archive" }),
    ),
  );
  mutation.mutateAsync.mockRejectedValue(new Error("private"));
  fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
  await screen.findByText(
    "The export artifact could not be prepared for download.",
  );
  open.mockRestore();
});
it.each(["pending", "unavailable", "failed"])(
  "labels export status %s without exposing download",
  async (state) => {
    prime();
    mutation.mutateAsync.mockResolvedValue({ export: { id: "export-id" } });
    queries.useTechnicalFileSnapshotExportQuery.mockReturnValue(
      state === "pending"
        ? { isPending: true }
        : state === "unavailable"
          ? { isPending: false, isError: true }
          : {
              isPending: false,
              isError: false,
              data: {
                export: { status: "failed", failureCode: "egress_blocked" },
              },
            },
    );
    renderSnapshots();
    fireEvent.click(screen.getByRole("button", { name: "Export snapshot" }));
    await screen.findByText(/Export generation was queued/);
    expect(
      screen.getByText(
        state === "pending"
          ? "Loading export status…"
          : state === "unavailable"
            ? "Export status is temporarily unavailable."
            : "Failure: egress blocked",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Download PDF" }),
    ).not.toBeInTheDocument();
  },
);
