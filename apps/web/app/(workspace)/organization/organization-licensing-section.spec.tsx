// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import { OrganizationLicensingSection } from "./organization-licensing-section";
const fixtures = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isPending: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  history: { data: undefined, refetch: vi.fn() },
  activation: { isPending: false, mutateAsync: vi.fn() },
  canView: true,
  canManage: true,
  revoked: false,
}));
vi.mock("../../_features/licensing/licensing.queries", () => ({
  useLicensingQueries: () => fixtures,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fixtures.current.error = null;
  fixtures.canView = true;
  fixtures.current.data = undefined;
  fixtures.current.isPending = false;
  fixtures.canManage = true;
  fixtures.revoked = false;
});
const current = {
  version: 2,
  instanceId: "instance",
  keyId: "issuer",
  digest: "digest",
  claims: {
    organizationId: "tenant",
    entitlements: ["products"],
    limits: { activeMembers: 5, products: null, storageBytes: 1000 },
  },
  usage: {
    activeMembers: 3,
    products: 2,
    storageBytes: 400,
    storageReservedBytes: 100,
    protectedStorageBytes: 200,
    availability: "ready",
  },
  lastRejected: {
    reason: "invalid_signature",
    occurredAt: "2026-10-01T00:00:00Z",
  },
  policy: {
    state: "active",
    reasons: [],
    warnings: [],
    effectiveCapabilities: ["products"],
    disabledCapabilities: [],
    customerWritesAllowed: true,
    expiresAt: "2027-01-01T00:00:00Z",
    graceEndsAt: "2027-01-31T00:00:00Z",
  },
};
describe("OrganizationLicensingSection", () => {
  it("separates rejected replacements and shows accessible usage", () => {
    fixtures.current.data = current;
    render(<OrganizationLicensingSection organizationId="tenant" />);
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText(/invalid signature/i)).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Licence capacity" }),
    ).toBeVisible();
    expect(screen.getByText("Unlimited")).toBeVisible();
  });
  it("keeps a draft on activation conflict", async () => {
    fixtures.current.data = current;
    fixtures.activation.mutateAsync.mockRejectedValue(
      new Error("Replacement conflict"),
    );
    render(<OrganizationLicensingSection organizationId="tenant" />);
    fireEvent.change(screen.getByLabelText("Signed licence artifact"), {
      target: { value: "a.b.c" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate licence" }));
    await waitFor(() =>
      expect(screen.getByText("Replacement conflict")).toBeVisible(),
    );
    expect(screen.getByLabelText("Signed licence artifact")).toHaveValue(
      "a.b.c",
    );
  });
  it("shows permission failure without exposing current claims", () => {
    fixtures.current.data = current;
    fixtures.canView = false;
    render(<OrganizationLicensingSection organizationId="tenant" />);
    expect(screen.getByText(/permission to view licences/)).toBeVisible();
    expect(screen.queryByText("instance")).not.toBeInTheDocument();
  });
});

describe("licence lifecycle and recovery", () => {
  it.each([
    "missing",
    "grace",
    "expired_read_only",
    "invalid",
    "clock_untrusted",
  ])("shows %s without hiding protected exports", (state) => {
    fixtures.current.data = {
      ...current,
      claims: null,
      lastRejected: null,
      policy: {
        ...current.policy,
        state,
        customerWritesAllowed: false,
        reasons: ["expired"],
        warnings: ["approaching_limit"],
        disabledCapabilities: ["products"],
        effectiveCapabilities: [],
      },
      usage: { ...current.usage, availability: "unavailable" },
    };
    render(<OrganizationLicensingSection organizationId="tenant" />);
    expect(
      screen.getByText(/manual evidence export remains available/),
    ).toBeVisible();
    expect(screen.getAllByText("Unavailable")).toHaveLength(3);
    expect(screen.getByText(/Disabled by configuration/)).toBeVisible();
  });
  it("keeps editing unavailable while loading and supports retry", () => {
    fixtures.current.isPending = true;
    fixtures.current.error = new Error("offline");
    render(<OrganizationLicensingSection organizationId="tenant" />);
    expect(screen.getByText("Loading licence…")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry licence status" }),
    );
    expect(fixtures.current.refetch).toHaveBeenCalled();
    fixtures.current.isPending = false;
  });
  it("activates and clears a successful draft", async () => {
    fixtures.current.data = current;
    fixtures.activation.mutateAsync.mockResolvedValue({ version: 3 });
    render(<OrganizationLicensingSection organizationId="tenant" />);
    fireEvent.change(screen.getByLabelText("Signed licence artifact"), {
      target: { value: "a.b.c" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate licence" }));
    await waitFor(() =>
      expect(screen.getByText(/Licence activated/)).toBeVisible(),
    );
    expect(screen.getByLabelText("Signed licence artifact")).toHaveValue("");
  });
  it("resets the draft when tenant changes", () => {
    fixtures.current.data = current;
    const view = render(
      <OrganizationLicensingSection organizationId="tenant" />,
    );
    fireEvent.change(screen.getByLabelText("Signed licence artifact"), {
      target: { value: "a.b.c" },
    });
    view.rerender(<OrganizationLicensingSection organizationId="other" />);
    expect(screen.getByLabelText("Signed licence artifact")).toHaveValue("");
  });
  it("rejects oversized pasted content without transport", async () => {
    fixtures.current.data = current;
    render(<OrganizationLicensingSection organizationId="tenant" />);
    fireEvent.change(screen.getByLabelText("Signed licence artifact"), {
      target: { value: "é".repeat(20000) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate licence" }));
    expect(await screen.findByText(/no larger than 32 KiB/)).toBeVisible();
    expect(fixtures.activation.mutateAsync).not.toHaveBeenCalled();
  });
  it("supports bounded file input and handles read failure", async () => {
    fixtures.current.data = current;
    render(<OrganizationLicensingSection organizationId="tenant" />);
    const file = { size: 5, text: vi.fn().mockResolvedValue("a.b.c") };
    fireEvent.change(screen.getByLabelText("Upload licence file"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Signed licence artifact")).toHaveValue(
        "a.b.c",
      ),
    );
    fireEvent.change(screen.getByLabelText("Upload licence file"), {
      target: { files: [{ size: 40000 }] },
    });
    expect(screen.getByText(/no larger than 32 KiB/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Upload licence file"), {
      target: {
        files: [
          { size: 5, text: vi.fn().mockRejectedValue(new Error("denied")) },
        ],
      },
    });
    expect(await screen.findByText(/file could not be read/)).toBeVisible();
  });
  it("keeps readonly licence information for viewers", () => {
    fixtures.current.data = current;
    fixtures.canManage = false;
    render(<OrganizationLicensingSection organizationId="tenant" />);
    expect(
      screen.getByRole("button", { name: "Activate licence" }),
    ).toBeDisabled();
    expect(screen.getByText(/cannot replace it/)).toBeVisible();
    fixtures.canManage = true;
  });
});

it("displays exempt protected storage separately from the licensed cap", () => {
  fixtures.current.data = current;
  render(<OrganizationLicensingSection organizationId="tenant" />);
  expect(screen.getByText(/Protected storage: 200 bytes/)).toBeVisible();
  expect(
    screen.getByText(/exempt from the customer storage limit/),
  ).toBeVisible();
});
it("reuses the original receipt key and version after an ambiguous failure and status refresh", async () => {
  fixtures.current.data = current;
  fixtures.activation.mutateAsync
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce({ version: 3 });
  const view = render(<OrganizationLicensingSection organizationId="tenant" />);
  fireEvent.change(screen.getByLabelText("Signed licence artifact"), {
    target: { value: "a.b.c" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Activate licence" }));
  await screen.findByText("Network unavailable");
  const first = fixtures.activation.mutateAsync.mock.calls[0]?.[0];
  fixtures.current.data = { ...current, version: 3 };
  view.rerender(<OrganizationLicensingSection organizationId="tenant" />);
  fireEvent.click(screen.getByRole("button", { name: "Activate licence" }));
  await waitFor(() =>
    expect(fixtures.activation.mutateAsync).toHaveBeenCalledTimes(2),
  );
  expect(fixtures.activation.mutateAsync.mock.calls[1]?.[0]).toEqual(first);
});
it("uses a new receipt key and refreshed version after a confirmed conflict", async () => {
  fixtures.current.data = current;
  fixtures.activation.mutateAsync
    .mockRejectedValueOnce(new ApiClientError("api", "Conflict", 409))
    .mockResolvedValueOnce({ version: 4 });
  const view = render(<OrganizationLicensingSection organizationId="tenant" />);
  fireEvent.change(screen.getByLabelText("Signed licence artifact"), {
    target: { value: "a.b.c" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Activate licence" }));
  await screen.findByText(/The licence changed while/);
  const first = fixtures.activation.mutateAsync.mock.calls[0]?.[0];
  fixtures.current.data = { ...current, version: 3 };
  view.rerender(<OrganizationLicensingSection organizationId="tenant" />);
  fireEvent.click(screen.getByRole("button", { name: "Activate licence" }));
  await waitFor(() =>
    expect(fixtures.activation.mutateAsync).toHaveBeenCalledTimes(2),
  );
  const second = fixtures.activation.mutateAsync.mock.calls[1]?.[0];
  expect(second.expectedVersion).toBe(3);
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
});
