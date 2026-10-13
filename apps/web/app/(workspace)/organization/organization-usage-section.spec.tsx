// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  usageReceipt,
  usageSnapshot,
  usageOrganizationId,
} from "../../_features/licensing/test/usage-fixtures";
import { useLicensingQueries } from "../../_features/licensing/licensing.queries";
import { OrganizationUsageSection as UsageSection } from "./organization-usage-section";
const fixture = vi.hoisted(() => ({
  usage: {
    data: undefined as ReturnType<typeof usageSnapshot> | undefined,
    isPending: false,
    isFetching: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  usageExport: { isPending: false, mutateAsync: vi.fn() },
  reconciliation: { isPending: false, mutateAsync: vi.fn() },
  canView: true,
  canManage: true,
  enabled: true,
  revoked: false,
  scope: "tenant-user-permissions",
}));
vi.mock("../../_features/licensing/licensing.queries", () => ({
  useLicensingQueries: () => fixture,
}));
const createObjectURL = vi.fn(() => "blob:usage");
const revokeObjectURL = vi.fn();
beforeEach(() => {
  fixture.usage.refetch.mockResolvedValue({ isError: false });
  fixture.usage.data = usageSnapshot();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL, revokeObjectURL }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fixture.usage.error = null;
  fixture.usage.isPending = false;
  fixture.usage.isFetching = false;
  fixture.canView = true;
  fixture.canManage = true;
  fixture.revoked = false;
  fixture.enabled = true;
  fixture.scope = "tenant-user-permissions";
  fixture.reconciliation.isPending = false;
  fixture.usageExport.isPending = false;
});
function OrganizationUsageSection({
  organizationId,
}: {
  organizationId: string;
}) {
  return (
    <UsageSection
      organizationId={organizationId}
      queries={useLicensingQueries()}
    />
  );
}
function renderUsage() {
  return render(
    <OrganizationUsageSection organizationId={usageOrganizationId} />,
  );
}

describe("organization usage", () => {
  it("shows definitions, components, periods and accessible status separately from regulatory authority", () => {
    renderUsage();
    expect(
      screen.getByRole("table", { name: "Licence capacity" }),
    ).toBeVisible();
    expect(
      screen.getByText("Active members and reserved invitations"),
    ).toBeVisible();
    expect(screen.getAllByText("Nonarchived products")[0]!).toBeVisible();
    expect(screen.getByText(/No calendar reset/)).toBeVisible();
    expect(screen.getByText(/regulatory approvals/)).toBeVisible();
    expect(screen.getByText(/Never reconciled/)).toBeVisible();
    expect(screen.getAllByText("Within limit")).toHaveLength(3);
    expect(screen.getByText("Exempt")).toBeVisible();
  });
  it.each([
    [8, "near_limit", "Near limit"],
    [10, "at_limit", "At limit"],
    [11, "over_limit", "Over limit"],
  ] as const)(
    "communicates %s without relying on colour",
    (value, state, label) => {
      fixture.usage.data!.counters[1] = {
        ...fixture.usage.data!.counters[1]!,
        value,
        state,
        components: [{ key: "products", value }],
      };
      renderUsage();
      expect(screen.getByText(label)).toBeVisible();
    },
  );
  it("formats bytes compactly while exposing exact bytes and unlimited limits", () => {
    fixture.usage.data!.counters[2] = {
      ...fixture.usage.data!.counters[2]!,
      value: 2048,
      components: [
        { key: "storageBytes", value: 1024 },
        { key: "storageReservedBytes", value: 1024 },
      ],
      limit: { kind: "unlimited", value: null },
    };
    renderUsage();
    expect(screen.getByText("2 KiB")).toHaveAccessibleName("2,048 bytes");
    expect(screen.getByText("Unlimited")).toBeVisible();
  });
  it("does not turn unavailable or unverified data into zero or unlimited", () => {
    fixture.usage.data!.counters[0] = {
      ...fixture.usage.data!.counters[0]!,
      value: null,
      availability: "unavailable",
      state: "unavailable",
      reasons: ["meter_unavailable"],
      components: [
        { key: "activeMembers", value: null },
        { key: "reservedInvitations", value: 0 },
      ],
      limit: { kind: "unverified", value: null },
    };
    renderUsage();
    const row = screen.getByRole("row", {
      name: /Active members and reserved invitations/,
    });
    expect(within(row).getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(within(row).getByText("Unverified limit")).toBeVisible();
  });
  it("handles loading, failed reads, retry and stale readings", () => {
    fixture.usage.isPending = true;
    fixture.usage.data = undefined;
    const view = renderUsage();
    expect(screen.getByText("Loading usage…")).toBeVisible();
    fixture.usage.isPending = false;
    fixture.usage.error = new Error("offline");
    fixture.usage.data = usageSnapshot();
    view.rerender(
      <OrganizationUsageSection organizationId={usageOrganizationId} />,
    );
    expect(
      screen.getByText(/previously loaded readings may be stale/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    expect(fixture.usage.refetch).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
  });
  it("forbids data after permission revocation and tenant change", () => {
    const view = renderUsage();
    fixture.canView = false;
    view.rerender(
      <OrganizationUsageSection organizationId={usageOrganizationId} />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/permission to view usage/)).toBeVisible();
    fixture.canView = true;
    view.rerender(<OrganizationUsageSection organizationId="different" />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
  it("allows viewer export, preserves the audited snapshot and revokes download URLs", async () => {
    fixture.canManage = false;
    fixture.usageExport.mutateAsync.mockResolvedValue(usageReceipt());
    renderUsage();
    expect(
      screen.queryByRole("button", { name: "Reconcile usage" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    await screen.findByText(/JSON usage snapshot downloaded/);
    expect(createObjectURL).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:usage"),
    );
  });
  it("retries ambiguous reconciliation with the same key and versions after refresh", async () => {
    fixture.reconciliation.mutateAsync
      .mockRejectedValueOnce(new Error("Network interrupted"))
      .mockResolvedValueOnce({
        checked: 1,
        repaired: 1,
        released: 0,
        unresolved: 0,
        replayed: true,
      });
    const view = renderUsage();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile usage" }));
    await screen.findByText("Network interrupted");
    const input = fixture.reconciliation.mutateAsync.mock.calls[0]![0];
    fixture.usage.data = { ...usageSnapshot(), meterVersion: 5 };
    view.rerender(
      <OrganizationUsageSection organizationId={usageOrganizationId} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry reconciliation" }),
    );
    await screen.findByText(/Reconciliation replayed/);
    expect(fixture.reconciliation.mutateAsync.mock.calls[1]![0]).toEqual(input);
  });
  it.each([409, 503])("handles %s with explicit recovery", async (status) => {
    fixture.reconciliation.mutateAsync.mockRejectedValue(
      new ApiClientError("api", "busy", status),
    );
    const view = renderUsage();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile usage" }));
    await screen.findByRole("alert");
    expect(
      screen.getByText(status === 409 ? /changed.*Refresh/ : /busy.*retry/i),
    ).toBeVisible();
    if (status === 409) {
      expect(
        screen.getByRole("button", { name: "Reconcile usage" }),
      ).toBeDisabled();
      fixture.usage.data = { ...usageSnapshot(), meterVersion: 5 };
      view.rerender(
        <OrganizationUsageSection organizationId={usageOrganizationId} />,
      );
      expect(
        screen.getByRole("button", { name: "Reconcile usage" }),
      ).toBeEnabled();
    }
  });
  it("announces pending work and prevents duplicate submissions", () => {
    fixture.reconciliation.isPending = true;
    renderUsage();
    expect(screen.getByRole("button", { name: "Reconciling…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });
  it("never downloads a late response after tenant scope changes", async () => {
    let resolve!: (value: ReturnType<typeof usageReceipt>) => void;
    fixture.usageExport.mutateAsync.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = renderUsage();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    fixture.scope = "other-user";
    view.rerender(
      <OrganizationUsageSection organizationId={usageOrganizationId} />,
    );
    resolve(usageReceipt());
    await waitFor(() =>
      expect(fixture.usageExport.mutateAsync).toHaveBeenCalledOnce(),
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

it("starts a new explicit input after refreshing a confirmed conflict even with unchanged versions", async () => {
  fixture.reconciliation.mutateAsync
    .mockRejectedValueOnce(new ApiClientError("api", "Conflict", 409))
    .mockResolvedValueOnce({
      checked: 0,
      repaired: 0,
      released: 0,
      unresolved: 0,
      replayed: false,
    });
  renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "Reconcile usage" }));
  await screen.findByText(/Licence or usage changed/);
  const first = fixture.reconciliation.mutateAsync.mock.calls[0]![0];
  fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Reconcile usage" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reconcile usage" }));
  await screen.findByText(/Reconciliation completed/);
  expect(
    fixture.reconciliation.mutateAsync.mock.calls[1]![0].idempotencyKey,
  ).not.toBe(first.idempotencyKey);
});
it("keeps conflict blocked when refresh fails", async () => {
  fixture.reconciliation.mutateAsync.mockRejectedValue(
    new ApiClientError("api", "Conflict", 409),
  );
  fixture.usage.refetch.mockResolvedValue({ isError: true });
  renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "Reconcile usage" }));
  await screen.findByText(/Licence or usage changed/);
  fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
  expect(
    screen.getByRole("button", { name: "Reconcile usage" }),
  ).toBeDisabled();
});
it("retries export in another format from the same audited request and focuses its status", async () => {
  fixture.usageExport.mutateAsync
    .mockRejectedValueOnce(new Error("Network interrupted"))
    .mockResolvedValueOnce({ ...usageReceipt(), replayed: true });
  renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
  await screen.findByText("Network interrupted");
  const first = fixture.usageExport.mutateAsync.mock.calls[0]![0];
  fireEvent.click(screen.getByRole("button", { name: "Retry export CSV" }));
  const status = await screen.findByText(
    /CSV usage snapshot downloaded from the original audited receipt/,
  );
  expect(fixture.usageExport.mutateAsync.mock.calls[1]![0]).toEqual(first);
  await waitFor(() => expect(status).toHaveFocus());
});
it("cleans up a failed local download and retains an auditable retry", async () => {
  fixture.usageExport.mutateAsync.mockResolvedValue(usageReceipt());
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    throw new Error("Download unavailable");
  });
  renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  await screen.findByText("Download unavailable");
  await waitFor(() =>
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:usage"),
  );
  expect(document.querySelector("a[download]")).toBeNull();
});
it("suppresses a late export after permission revocation", async () => {
  let resolve!: (value: ReturnType<typeof usageReceipt>) => void;
  fixture.usageExport.mutateAsync.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
  fixture.revoked = true;
  view.rerender(
    <OrganizationUsageSection organizationId={usageOrganizationId} />,
  );
  resolve(usageReceipt());
  await waitFor(() =>
    expect(screen.getByText(/permission to view usage/)).toBeVisible(),
  );
  expect(createObjectURL).not.toHaveBeenCalled();
});
it("rejects an export response for another organization", async () => {
  fixture.usageExport.mutateAsync.mockResolvedValue({
    ...usageReceipt(),
    snapshot: { ...usageSnapshot(), organizationId: "different" },
  });
  renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
  await screen.findByText(/organization mismatch/);
  expect(createObjectURL).not.toHaveBeenCalled();
});
it("shows license and reconciliation provenance without claiming unknown limits", () => {
  const snapshot = usageSnapshot();
  fixture.usage.data = {
    ...snapshot,
    reconciledAt: snapshot.observedAt,
    license: {
      ...snapshot.license,
      verified: false,
      effectiveCapabilities: [],
      reasons: ["invalid_signature"],
    },
    counters: snapshot.counters.map((row) =>
      row.id === "protected_storage"
        ? row
        : {
            ...row,
            limit: { kind: "unverified", value: null },
            state: "unavailable",
          },
    ),
  };
  renderUsage();
  expect(screen.getByText(/Licence limits are unverified/)).toBeVisible();
  expect(screen.getByText(/invalid signature/i)).toBeVisible();
  expect(screen.getAllByText("Unverified limit")).toHaveLength(3);
  expect(screen.queryByText("Never reconciled")).not.toBeInTheDocument();
});

it("preserves the same request identity when the actual API reports busy as 409", async () => {
  fixture.reconciliation.mutateAsync
    .mockRejectedValueOnce(
      new ApiClientError(
        "api",
        "Reconciliation is already running",
        409,
        "license_usage_busy",
      ),
    )
    .mockResolvedValueOnce({
      checked: 0,
      repaired: 0,
      released: 0,
      unresolved: 0,
      replayed: false,
    });
  const view = renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "Reconcile usage" }));
  await screen.findByText(/Usage operation is busy/);
  const first = fixture.reconciliation.mutateAsync.mock.calls[0]![0];
  fixture.usage.data = { ...usageSnapshot(), meterVersion: 5 };
  view.rerender(
    <OrganizationUsageSection organizationId={usageOrganizationId} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry reconciliation" }));
  await screen.findByText(/Reconciliation completed/);
  expect(fixture.reconciliation.mutateAsync.mock.calls[1]![0]).toEqual(first);
});

it("distinguishes unavailable accounting from a busy reconciliation", async () => {
  fixture.reconciliation.mutateAsync.mockRejectedValue(
    new ApiClientError(
      "api",
      "Temporarily unavailable",
      503,
      "license_usage_unavailable",
    ),
  );
  renderUsage();
  fireEvent.click(screen.getByRole("button", { name: "Reconcile usage" }));
  await screen.findByText(/Usage is temporarily unavailable/);
  expect(
    screen.getByRole("button", { name: "Retry reconciliation" }),
  ).toBeEnabled();
});
