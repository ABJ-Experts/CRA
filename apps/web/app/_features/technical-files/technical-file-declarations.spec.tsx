// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TechnicalFileDeclarations } from "./technical-file-declarations";

const queries = vi.hoisted(() => ({
  useTechnicalFileSnapshotsQuery: vi.fn(),
  useTechnicalFileDeclarationsQuery: vi.fn(),
  useSaveTechnicalFileDeclarationDraftMutation: vi.fn(),
  useTechnicalFileDeclarationPreviewQuery: vi.fn(),
  useIssueTechnicalFileDeclarationMutation: vi.fn(),
  useReissueTechnicalFileDeclarationMutation: vi.fn(),
  useTechnicalFileDeclarationDownloadMutation: vi.fn(),
}));

vi.mock("./technical-files.queries", () => queries);

const productId = "11111111-1111-4111-8111-111111111111";
const snapshotId = "22222222-2222-4222-8222-222222222222";

function prime() {
  queries.useTechnicalFileSnapshotsQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      snapshots: [
        {
          id: snapshotId,
          purpose: "audit",
          readinessStatus: "complete",
          status: "current",
          createdAt: "2026-09-15T00:00:00.000Z",
          payloadSha256: "a".repeat(64),
        },
      ],
    },
  });
  queries.useTechnicalFileDeclarationsQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: { declarations: [] },
  });
  queries.useSaveTechnicalFileDeclarationDraftMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  queries.useTechnicalFileDeclarationPreviewQuery.mockReturnValue({
    isPending: false,
    isError: false,
    data: {
      preview: {
        template: {
          version: "2024-11-20",
          legalAct: "Regulation (EU) 2024/2847",
          annex: "Annex V",
        },
        signatory: { name: "Owner" },
        snapshotSha256: "a".repeat(64),
        expectedVersion: 1,
        readinessStatus: "complete",
        missingFacts: [
          {
            key: "manufacturer_address",
            label: "Manufacturer address",
            reason: "No approved legal profile is available.",
          },
        ],
        sourceProvenance: [],
        canIssue: false,
      },
    },
  });
  queries.useIssueTechnicalFileDeclarationMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  queries.useReissueTechnicalFileDeclarationMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
  queries.useTechnicalFileDeclarationDownloadMutation.mockReturnValue({
    isPending: false,
    mutateAsync: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TechnicalFileDeclarations", () => {
  it("shows the immutable snapshot binding and explicit missing-fact blocker", () => {
    prime();
    render(
      <TechnicalFileDeclarations
        productId={productId}
        enabled
        canView
        canIssue={false}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "EU declarations of conformity" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Manufacturer address:")).toBeInTheDocument();
    expect(
      screen.getByText(/do not have permission to issue a declaration/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Create a snapshot" }),
    ).toHaveAttribute("href", "#technical-file-snapshots");
  });

  it("does not present a live-fact form without a complete current snapshot", () => {
    prime();
    queries.useTechnicalFileSnapshotsQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        snapshots: [
          {
            id: snapshotId,
            purpose: "audit",
            readinessStatus: "stale",
            status: "current",
            createdAt: "2026-09-15T00:00:00.000Z",
            payloadSha256: "a".repeat(64),
          },
        ],
      },
    });
    render(
      <TechnicalFileDeclarations
        productId={productId}
        enabled
        canView
        canIssue
      />,
    );

    expect(
      screen.getByText(/No complete current snapshot is available/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save declaration draft" }),
    ).toBeNull();
  });
});
