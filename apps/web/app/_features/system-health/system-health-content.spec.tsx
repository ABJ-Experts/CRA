// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemHealthContent } from "./system-health-content";
import { ApiClientError } from "../../_lib/http/api-client";
import { healthFixture, healthOrg } from "./system-health.fixture";
import { SystemHealthTables, observationTime } from "./system-health-tables";

const scope = {
  userId: "user",
  organizationId: healthOrg,
  permissionRevision: "one",
};
describe("customer health presentation", () => {
  afterEach(cleanup);
  it("shows provenance, qualified counts and honest assurance", async () => {
    render(
      <SystemHealthContent
        scope={scope}
        canView
        gateway={{ read: vi.fn().mockResolvedValue(healthFixture) }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await screen.findByRole("table", { name: "Components" });
    expect(
      screen.getByRole("table", { name: "Background work" }).textContent,
    ).toContain("At least 10,000");
    expect(screen.getByText("Protected, exempt bytes")).toBeTruthy();
    expect(
      screen.getByText("Last verified restore").parentElement?.textContent,
    ).toContain("Unknown");
    expect(screen.getByText("Unverified version")).toBeTruthy();
    expect(
      screen.getByText(/Existing evidence exports remain/).textContent,
    ).toContain("normally authorized");
    expect(
      screen.getByRole("link", { name: "Licence" }).getAttribute("href"),
    ).toBe("/organization?settings=licence");
  });
  it("clears data immediately on tenant change, ignores late responses, and aborts", async () => {
    let resolve!: (value: typeof healthFixture) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(healthFixture))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
    const view = render(
      <SystemHealthContent scope={scope} canView gateway={{ read }} />,
    );
    await screen.findByRole("table", { name: "Components" });
    const next = {
      ...scope,
      organizationId: "22222222-2222-4222-8222-222222222222",
    };
    view.rerender(
      <SystemHealthContent scope={next} canView gateway={{ read }} />,
    );
    expect(screen.queryByRole("table", { name: "Components" })).toBeNull();
    expect(read.mock.calls[0]?.[1]?.aborted).toBe(true);
    view.rerender(
      <SystemHealthContent scope={next} canView={false} gateway={{ read }} />,
    );
    resolve(healthFixture);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("permission"),
    );
    expect(screen.queryByRole("table", { name: "Components" })).toBeNull();
  });
  it.each([403, 409, 503])(
    "shows safe %s failure and allows a manual retry",
    async (status) => {
      const read = vi
        .fn()
        .mockRejectedValueOnce(
          new ApiClientError("api", "private failure", status),
        )
        .mockResolvedValueOnce(healthFixture);
      render(<SystemHealthContent scope={scope} canView gateway={{ read }} />);
      await screen.findByRole("alert");
      expect(screen.getByRole("alert").textContent).not.toContain(
        "private failure",
      );
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await screen.findByRole("table", { name: "Components" });
    },
  );
  it("does not fetch without identity or authorization", () => {
    const read = vi.fn();
    render(<SystemHealthContent scope={null} canView gateway={{ read }} />);
    expect(screen.getByRole("status").textContent).toContain(
      "current organization",
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("refreshes manually and shows withheld metadata as unknown", async () => {
    const read = vi.fn().mockResolvedValue(healthFixture);
    render(<SystemHealthContent scope={scope} canView gateway={{ read }} />);
    await screen.findByRole("table", { name: "Components" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh health" }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    cleanup();
    const ready = healthFixture.queues[0]!;
    render(
      <SystemHealthTables
        data={{
          ...healthFixture,
          licence: {
            ...healthFixture.licence,
            state: null,
            managementUrl: null,
            usageUrl: null,
          },
          currentVersion: { ...healthFixture.currentVersion, version: "1.2.3" },
          storage: {
            ...healthFixture.storage,
            customerBytes: null,
            customerReservedBytes: null,
            protectedBytes: null,
          },
          queues: [
            {
              ...ready,
              countRelation: null,
              pending: null,
              running: null,
              retrying: null,
              waitingForReview: null,
              uncertainDelivery: null,
              failedTerminal: null,
            },
            {
              ...ready,
              id: "reports",
              label: "Reports",
              countRelation: "exact",
              pending: 0,
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("table", { name: "Background work" }).textContent,
    ).toContain("Unknown / withheld");
    expect(screen.queryByRole("link", { name: "Licence" })).toBeNull();
    expect(observationTime(null)).toBe("Unknown");
  });
});
