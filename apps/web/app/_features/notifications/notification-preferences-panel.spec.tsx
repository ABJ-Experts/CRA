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
import { NotificationPreferencesPanel } from "./notification-preferences-panel";

const update = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const refetch = vi.fn();
const userId = "11111111-1111-4111-8111-111111111111";

const preferences = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  userId,
  version: 3,
  modes: {
    finding_triage: "immediate",
    evidence: "daily",
    supplier_owner: "off",
  },
  schedule: {
    timezone: "Europe/London",
    localTime: "09:30",
    weekday: 2,
    quietHours: { start: "22:00", end: "07:00" },
  },
} as const;

type PreferencesQueryState = Readonly<{
  data: { preferences: typeof preferences } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: typeof refetch;
}>;

const query = vi.hoisted(() => ({
  state: null as PreferencesQueryState | null,
}));

vi.mock("./notifications.queries", () => ({
  useNotificationPreferencesQuery: () => query.state!,
  useUpdateNotificationPreferencesMutation: () => update,
}));

describe("NotificationPreferencesPanel", () => {
  beforeEach(() => {
    query.state = {
      data: { preferences },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    update.isPending = false;
  });

  it("saves optional category preferences with version and idempotency", async () => {
    update.mutateAsync.mockResolvedValue({ preferences });
    render(<NotificationPreferencesPanel />);

    fireEvent.change(screen.getByLabelText("Evidence"), {
      target: { value: "weekly" },
    });
    fireEvent.change(screen.getByLabelText("Digest time"), {
      target: { value: "08:15" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save notification preferences" }),
    );

    await waitFor(() =>
      expect(update.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: 3,
          idempotencyKey: expect.any(String),
          modes: expect.objectContaining({ evidence: "weekly" }),
          schedule: expect.objectContaining({ localTime: "08:15" }),
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Notification preferences saved.",
    );
  });

  it("keeps partial quiet-hours text until save validation", async () => {
    update.mutateAsync.mockResolvedValue({ preferences });
    render(<NotificationPreferencesPanel />);

    const quietHours = screen.getByLabelText("Quiet hours");
    fireEvent.change(quietHours, { target: { value: "2" } });
    expect(quietHours).toHaveValue("2");

    fireEvent.change(quietHours, { target: { value: "22:00-" } });
    expect(quietHours).toHaveValue("22:00-");

    fireEvent.click(
      screen.getByRole("button", { name: "Save notification preferences" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("HH:MM-HH:MM");
    expect(update.mutateAsync).not.toHaveBeenCalled();
    expect(quietHours).toHaveValue("22:00-");
  });

  it("saves completed quiet-hours text as schedule data", async () => {
    update.mutateAsync.mockResolvedValue({
      preferences: {
        ...preferences,
        schedule: {
          ...preferences.schedule,
          quietHours: { start: "21:00", end: "06:00" },
        },
      },
    });
    render(<NotificationPreferencesPanel />);

    fireEvent.change(screen.getByLabelText("Quiet hours"), {
      target: { value: "21:00-06:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save notification preferences" }),
    );

    await waitFor(() =>
      expect(update.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: expect.objectContaining({
            quietHours: { start: "21:00", end: "06:00" },
          }),
        }),
      ),
    );
  });

  it("preserves drafts and exposes retry copy after an offline save", async () => {
    update.mutateAsync.mockRejectedValue(
      new ApiClientError("network", "Offline"),
    );
    render(<NotificationPreferencesPanel />);

    fireEvent.change(screen.getByLabelText("Supplier owner requests"), {
      target: { value: "daily" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save notification preferences" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByLabelText("Supplier owner requests")).toHaveValue(
      "daily",
    );
  });

  it("shows loading and retry states", () => {
    query.state = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch,
    };
    const view = render(<NotificationPreferencesPanel />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading notification preferences",
    );

    query.state = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new ApiClientError("api", "Forbidden", 403),
      refetch,
    };
    view.rerender(<NotificationPreferencesPanel />);
    expect(screen.getByRole("alert")).toHaveTextContent("permission");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry notification preferences" }),
    );
    expect(refetch).toHaveBeenCalled();
  });
});
