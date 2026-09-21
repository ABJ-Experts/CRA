// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvidenceLibrary } from "./evidence-library";

const queries = vi.hoisted(() => ({
  useCompleteEvidenceUploadMutation: vi.fn(),
  useEvidenceDocumentsQuery: vi.fn(),
  useEvidenceVersionReuseQuery: vi.fn(),
  useEvidenceVersionsQuery: vi.fn(),
  useInitializeEvidenceUploadMutation: vi.fn(),
  useReplaceEvidenceMutation: vi.fn(),
}));

vi.mock("next/dynamic", () => ({ default: () => () => <div /> }));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({
    session: {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "owner@cra.test",
      },
      organizations: [{ id: "00000000-0000-4000-8000-000000000001" }],
    },
    permissions: {
      can_view_evidence: true,
      can_upload_evidence: false,
      can_edit_organization: false,
    },
    isLoading: false,
  }),
}));
vi.mock("./evidence.queries", () => queries);
vi.mock("./evidence-extracted-text", () => ({
  EvidenceExtractedText: () => <div />,
}));
vi.mock("./evidence-expiry-alert-settings", () => ({
  EvidenceExpiryAlertSettings: () => <div />,
}));
vi.mock("./evidence-reuse-panel", () => ({
  EvidenceReusePanel: () => <div />,
}));
vi.mock("./evidence-retention-panel", () => ({
  EvidenceRetentionPanel: () => <div />,
}));

const version = {
  id: "33333333-3333-4333-8333-333333333333",
  documentId: "22222222-2222-4222-8222-222222222222",
  organizationId: "00000000-0000-4000-8000-000000000001",
  versionNumber: 1,
  title: "Gateway test report",
  documentClass: "test_report",
  ownerUserId: "00000000-0000-4000-8000-000000000001",
  productIds: ["11111111-1111-4111-8111-111111111111"],
  validFrom: "2026-01-01T00:00:00.000Z",
  validUntil: "2026-10-01T00:00:00.000Z",
  fileName: "gateway.pdf",
  mediaType: "application/pdf",
  byteSize: 1,
  sha256: "a".repeat(64),
  status: "clean",
  scan: {
    outcome: "clean",
    engineName: "test",
    engineVersion: null,
    signatureVersion: null,
    scannedAt: "2026-09-01T00:00:00.000Z",
    detectionName: null,
  },
  extraction: null,
  uploadExpiresAt: null,
  uploadedByUserId: "00000000-0000-4000-8000-000000000001",
  completedAt: "2026-09-01T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
} as const;

describe("EvidenceLibrary", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("passes an explicit validity filter to the tenant-scoped list and opens reuse details", () => {
    queries.useEvidenceDocumentsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        items: [
          {
            document: {
              id: version.documentId,
              organizationId: version.organizationId,
              currentVersionId: version.id,
              currentVersion: version,
              createdByUserId: version.ownerUserId,
              createdAt: version.createdAt,
              updatedAt: version.createdAt,
            },
            validityStatus: "expiring_soon",
            linkageCount: 1,
          },
        ],
        nextCursor: null,
      },
      refetch: vi.fn(),
    });
    queries.useEvidenceVersionsQuery.mockReturnValue({
      data: { versions: [version] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    queries.useEvidenceVersionReuseQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { reuse: { technicalFileLinks: [], frameworkControls: [] } },
      refetch: vi.fn(),
    });
    for (const mutation of [
      queries.useCompleteEvidenceUploadMutation,
      queries.useInitializeEvidenceUploadMutation,
      queries.useReplaceEvidenceMutation,
    ]) {
      mutation.mockReturnValue({ mutateAsync: vi.fn() });
    }

    render(
      <EvidenceLibrary productId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(screen.getByLabelText("Expiring soon validity")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter by validity"), {
      target: { value: "expired" },
    });
    expect(queries.useEvidenceDocumentsQuery).toHaveBeenLastCalledWith(
      "11111111-1111-4111-8111-111111111111",
      true,
      { validity: "expired" },
    );
    fireEvent.click(screen.getByRole("button", { name: "1 link" }));
    expect(queries.useEvidenceVersionReuseQuery).toHaveBeenLastCalledWith(
      "11111111-1111-4111-8111-111111111111",
      version.documentId,
      version.id,
      true,
    );
  });
});
