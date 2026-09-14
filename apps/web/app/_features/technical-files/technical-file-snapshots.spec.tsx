// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  queries.useCreateTechnicalFileSnapshotExportMutation.mockReturnValue(mutation);
  queries.useCancelTechnicalFileSnapshotExportMutation.mockReturnValue(mutation);
  queries.useTechnicalFileSnapshotDownloadMutation.mockReturnValue(mutation);
  return canSnapshot;
}

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
    expect(screen.getByText(/Capture an audit-ready record/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export snapshot" })).toBeEnabled();
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

    expect(screen.queryByRole("button", { name: "Create snapshot" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export snapshot" })).toBeNull();
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

    expect(screen.getByRole("button", { name: "Export snapshot" })).toBeDisabled();
    expect(screen.getByText(/cannot be exported again/)).toBeInTheDocument();
  });
});
