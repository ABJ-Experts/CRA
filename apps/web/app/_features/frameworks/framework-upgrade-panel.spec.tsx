/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { frameworksApi } from "./frameworks.api";
import { FrameworkUpgradePanel } from "./framework-upgrade-panel";

const sourceRequirementKey = "old-r1";
const targetRequirementKey = "new-r1";
const mappingId = "11111111-1111-4111-8111-111111111111";
const reviewId = "22222222-2222-4222-8222-222222222222";
const preview = {
  packKey: "cra",
  sourceVersionKey: "v1",
  targetVersionKey: "v2",
  selectionRevision: 1,
  sourceHash: "a".repeat(64),
  targetHash: "b".repeat(64),
  fingerprint: "c".repeat(64),
  diff: {
    added: [targetRequirementKey],
    removed: [sourceRequirementKey],
    changed: [],
    split: [],
    merged: [],
  },
  impacts: [
    {
      mappingId,
      controlId: "33333333-3333-4333-8333-333333333333",
      controlRevision: 1,
      sourceRequirementKey,
      productIds: ["44444444-4444-4444-8444-444444444444"],
      evidenceVersionIds: [],
      suggestedTargetKeys: [targetRequirementKey],
    },
  ],
  nextCursor: null,
  totalImpacts: 1,
};

function mount(onCommitted = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FrameworkUpgradePanel
        organizationId="55555555-5555-4555-8555-555555555555"
        packKey="cra"
        sourceVersionKey="v1"
        targetVersionKey="v2"
        canManage
        canViewProducts
        canViewEvidence
        onCommitted={onCommitted}
      />
    </QueryClientProvider>,
  );
  return onCommitted;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FrameworkUpgradePanel", () => {
  it("does not read upgrade effects without product and evidence visibility", () => {
    const read = vi.spyOn(frameworksApi, "upgradePreview");
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <FrameworkUpgradePanel
          organizationId="55555555-5555-4555-8555-555555555555"
          packKey="cra"
          sourceVersionKey="v1"
          targetVersionKey="v2"
          canManage
          canViewProducts={false}
          canViewEvidence
          onCommitted={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(
      screen.getByText(/product visibility, and evidence visibility/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Commit upgrade" }),
    ).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it("commits a reviewed version choice when no active mappings are impacted", async () => {
    vi.spyOn(frameworksApi, "upgradePreview").mockResolvedValue({
      ...preview,
      impacts: [],
      totalImpacts: 0,
    });
    vi.spyOn(frameworksApi, "tree").mockResolvedValue({
      packKey: "cra",
      versionKey: "v2",
      editionDate: "2026-01-01",
      language: "en",
      nextCursor: null,
      requirements: [],
    });
    vi.spyOn(frameworksApi, "createUpgradeReview").mockResolvedValue({
      reviewId,
      packKey: "cra",
      sourceVersionKey: "v1",
      targetVersionKey: "v2",
      revision: 1,
      status: "draft",
    });
    const decision = vi.spyOn(frameworksApi, "upgradeDecision");
    vi.spyOn(frameworksApi, "commitUpgrade").mockResolvedValue({
      reviewId,
      selection: {
        packKey: "cra",
        versionKey: "v2",
        enabled: true,
        revision: 2,
      },
      migratedCount: 0,
      gapCount: 0,
    });
    const onCommitted = mount();
    expect(
      await screen.findByText(/No active control mappings require migration/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Commit upgrade" }));
    await waitFor(() => expect(onCommitted).toHaveBeenCalledOnce());
    expect(decision).not.toHaveBeenCalled();
  });

  it("requires an explicit mapping choice before a durable commit", async () => {
    vi.spyOn(frameworksApi, "upgradePreview").mockResolvedValue(preview);
    vi.spyOn(frameworksApi, "tree").mockResolvedValue({
      packKey: "cra",
      versionKey: "v2",
      editionDate: "2026-01-01",
      language: "en",
      nextCursor: null,
      requirements: [
        {
          requirementKey: targetRequirementKey,
          identifier: "R2",
          heading: "Target",
          text: "Target text",
          sourceReference: "Source",
          parentKey: null,
          position: 1,
          depth: 0,
        },
      ],
    });
    const create = vi
      .spyOn(frameworksApi, "createUpgradeReview")
      .mockResolvedValue({
        reviewId,
        packKey: "cra",
        sourceVersionKey: "v1",
        targetVersionKey: "v2",
        revision: 1,
        status: "draft",
      });
    const decision = vi
      .spyOn(frameworksApi, "upgradeDecision")
      .mockResolvedValue({ reviewId, revision: 2 });
    const commit = vi.spyOn(frameworksApi, "commitUpgrade").mockResolvedValue({
      reviewId,
      selection: {
        packKey: "cra",
        versionKey: "v2",
        enabled: true,
        revision: 2,
      },
      migratedCount: 1,
      gapCount: 0,
    });
    const onCommitted = mount();

    const action = await screen.findByRole("button", {
      name: "Commit upgrade",
    });
    expect(action).toBeDisabled();
    fireEvent.click(
      screen.getByRole("radio", {
        name: "Map to selected target requirements",
      }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "R2 — Target" }));
    expect(action).toBeEnabled();
    fireEvent.click(action);
    await waitFor(() => expect(onCommitted).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith(
      "cra",
      expect.objectContaining({
        targetVersionKey: "v2",
        expectedSelectionRevision: 1,
      }),
    );
    expect(decision).toHaveBeenCalledWith(
      "cra",
      reviewId,
      mappingId,
      expect.objectContaining({
        action: "map",
        targetRequirementKeys: [targetRequirementKey],
        expectedReviewRevision: 1,
      }),
    );
    expect(commit).toHaveBeenCalledWith(
      "cra",
      reviewId,
      expect.objectContaining({ expectedReviewRevision: 2 }),
    );
  });

  it("keeps a gap decision visible after a conflict and requires a refreshed preview", async () => {
    vi.spyOn(frameworksApi, "upgradePreview").mockResolvedValue(preview);
    vi.spyOn(frameworksApi, "tree").mockResolvedValue({
      packKey: "cra",
      versionKey: "v2",
      editionDate: "2026-01-01",
      language: "en",
      nextCursor: null,
      requirements: [],
    });
    vi.spyOn(frameworksApi, "createUpgradeReview").mockRejectedValueOnce(
      new ApiClientError("api", "Conflict", 409),
    );
    mount();
    const action = await screen.findByRole("button", {
      name: "Commit upgrade",
    });
    fireEvent.click(screen.getByRole("radio", { name: "Leave a visible gap" }));
    fireEvent.click(action);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /refresh the preview/i,
    );
    expect(
      screen.getByRole("radio", { name: "Leave a visible gap" }),
    ).toBeChecked();
    expect(action).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    expect(
      await screen.findByRole("button", { name: "Confirm refreshed decision" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Commit upgrade" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm refreshed decision" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Commit upgrade" }),
      ).toBeEnabled(),
    );
  });

  it("reconciles a lost commit response without repeating mapping writes", async () => {
    vi.spyOn(frameworksApi, "upgradePreview").mockResolvedValue(preview);
    vi.spyOn(frameworksApi, "tree").mockResolvedValue({
      packKey: "cra",
      versionKey: "v2",
      editionDate: "2026-01-01",
      language: "en",
      nextCursor: null,
      requirements: [],
    });
    vi.spyOn(frameworksApi, "createUpgradeReview").mockResolvedValue({
      reviewId,
      packKey: "cra",
      sourceVersionKey: "v1",
      targetVersionKey: "v2",
      revision: 1,
      status: "draft",
    });
    const decision = vi
      .spyOn(frameworksApi, "upgradeDecision")
      .mockResolvedValue({ reviewId, revision: 2 });
    const commit = vi
      .spyOn(frameworksApi, "commitUpgrade")
      .mockRejectedValueOnce(new ApiClientError("network", "Offline", 0));
    const review = vi.spyOn(frameworksApi, "upgradeReview").mockResolvedValue({
      reviewId,
      packKey: "cra",
      sourceVersionKey: "v1",
      targetVersionKey: "v2",
      revision: 2,
      status: "committed",
      decisions: [
        { mappingId, action: "leave_gap", targetRequirementKeys: [] },
      ],
      nextCursor: null,
    });
    const onCommitted = mount();
    const action = await screen.findByRole("button", {
      name: "Commit upgrade",
    });
    fireEvent.click(screen.getByRole("radio", { name: "Leave a visible gap" }));
    fireEvent.click(action);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /retry when online/i,
    );
    fireEvent.click(action);
    await waitFor(() => expect(onCommitted).toHaveBeenCalledOnce());
    expect(review).toHaveBeenCalledOnce();
    expect(decision).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });
});
