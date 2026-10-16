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

import { frameworksApi } from "./frameworks.api";
import { FrameworkCrosswalkPanel } from "./framework-crosswalk-panel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FrameworkCrosswalkPanel", () => {
  it("shows human review and one-way partial mappings without a coverage claim", async () => {
    vi.spyOn(frameworksApi, "crosswalks").mockResolvedValue({
      nextCursor: null,
      relations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          source: { packKey: "cra", versionKey: "v1", requirementKey: "r1" },
          target: { packKey: "iec", versionKey: "v1", requirementKey: "r2" },
          relationship: "partial",
          direction: "one_way",
          rationale: "Overlaps process evidence",
          provenance: "Curator worksheet",
          reviewer: "Standards editor",
          reviewedAt: "2026-01-01T00:00:00Z",
          curated: true,
        },
      ],
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FrameworkCrosswalkPanel
          organizationId="org-a"
          packKey="cra"
          versionKey="v1"
        />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("Overlaps process evidence"),
    ).toBeInTheDocument();
    expect(screen.getByText(/partial · one way/i)).toBeInTheDocument();
    expect(screen.getByText("Standards editor")).toBeInTheDocument();
    expect(
      screen.getByText(/does not establish equivalence or coverage/i),
    ).toBeInTheDocument();
  });

  it("recovers from a read failure and reports an empty curated catalog", async () => {
    vi.spyOn(frameworksApi, "crosswalks")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ relations: [], nextCursor: null });
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FrameworkCrosswalkPanel
          organizationId="org-a"
          packKey="cra"
          versionKey="v1"
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    fireEvent.click(screen.getByRole("button", { name: "Retry crosswalks" }));
    expect(
      await screen.findByText(/No curated crosswalk is published/i),
    ).toBeInTheDocument();
  });

  it("loads another page without treating one-way suggestions as equivalence", async () => {
    const relation = {
      id: "11111111-1111-4111-8111-111111111111",
      source: { packKey: "cra", versionKey: "v1", requirementKey: "r1" },
      target: { packKey: "iec", versionKey: "v1", requirementKey: "r2" },
      relationship: "uncertain" as const,
      direction: "one_way" as const,
      rationale: "Human review required",
      provenance: "Curator worksheet",
      reviewer: "Standards editor",
      reviewedAt: "2026-01-01T00:00:00Z",
      curated: true as const,
    };
    const read = vi
      .spyOn(frameworksApi, "crosswalks")
      .mockResolvedValueOnce({ relations: [relation], nextCursor: "next" })
      .mockResolvedValueOnce({
        relations: [
          { ...relation, id: "22222222-2222-4222-8222-222222222222" },
        ],
        nextCursor: null,
      });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FrameworkCrosswalkPanel
          organizationId="org-a"
          packKey="cra"
          versionKey="v1"
        />
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more crosswalks" }),
    );
    await waitFor(() =>
      expect(screen.getAllByText("Human review required")).toHaveLength(2),
    );
    expect(read).toHaveBeenLastCalledWith(
      "cra",
      "v1",
      "next",
      expect.anything(),
    );
  });
});
