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

import { SupplierEvidenceRemindersPanel } from "./supplier-evidence-reminders-panel";

const queries = vi.hoisted(() => ({
  useSupplierEvidenceReminderSettingsQuery: vi.fn(),
  useUpdateSupplierEvidenceReminderSettingsMutation: vi.fn(),
  useSupplierEvidenceMetricsQuery: vi.fn(),
  useSupplierEvidenceOverdueQuery: vi.fn(),
  useRetrySupplierEvidenceReminderMutation: vi.fn(),
}));

vi.mock("./supplier-evidence.queries", () => queries);

afterEach(cleanup);

const delivery = {
  id: "99999999-9999-4999-8999-999999999999",
  requestId: "11111111-1111-4111-8111-111111111111",
  revisionId: "22222222-2222-4222-8222-222222222222",
  dueAt: "2026-09-20T00:00:00.000Z",
  offsetHours: 24,
  recipient: "supplier",
  kind: "supplier_reminder",
  state: "failed",
  attemptCount: 3,
  nextAttemptAt: null,
  leasedUntil: null,
  failureMessage: "Mail provider rejected the delivery.",
  invitationId: null,
  deliveredAt: null,
  version: 4,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

describe("SupplierEvidenceRemindersPanel", () => {
  it("shows unavailable rates honestly and permits an explicit retry of a failed local delivery", async () => {
    queries.useSupplierEvidenceReminderSettingsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { settings: { version: 2, offsetsHours: [-168, -24, 24] } },
    });
    queries.useUpdateSupplierEvidenceReminderSettingsMutation.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });
    queries.useSupplierEvidenceMetricsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        summary: {
          from: "2026-08-22T00:00:00.000Z",
          to: "2026-09-22T00:00:00.000Z",
          outstandingCount: 1,
          overdueCount: 1,
          firstSubmissionResponseRate: {
            numerator: 0,
            denominator: 0,
            value: null,
          },
          acceptedCompletionRate: { numerator: 0, denominator: 1, value: 0 },
          averageFirstSubmissionTurnaroundHours: null,
          turnaroundSampleCount: 0,
        },
      },
    });
    queries.useSupplierEvidenceOverdueQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        overdue: [
          {
            requestId: delivery.requestId,
            revisionId: delivery.revisionId,
            supplierId: "77777777-7777-4777-8777-777777777777",
            productId: "66666666-6666-4666-8666-666666666666",
            requestTitle: "Signed supplier report",
            supplierDisplayName: "Example Supplier",
            dueAt: delivery.dueAt,
            daysOverdue: 2,
            state: "awaiting_review",
            latestDelivery: delivery,
          },
        ],
        nextCursor: null,
      },
    });
    const retry = vi.fn().mockResolvedValue(undefined);
    queries.useRetrySupplierEvidenceReminderMutation.mockReturnValue({
      isPending: false,
      mutateAsync: retry,
    });

    render(
      <SupplierEvidenceRemindersPanel
        supplierId="77777777-7777-4777-8777-777777777777"
        readEnabled
        canManage
      />,
    );

    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.getByText("Signed supplier report")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry reminder" }));
    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: delivery.id,
          input: expect.objectContaining({ expectedVersion: 4 }),
        }),
      ),
    );
  });

  it("keeps an entered reminder cadence after a stale update conflict", async () => {
    queries.useSupplierEvidenceReminderSettingsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { settings: { version: 2, offsetsHours: [-168, -24, 24] } },
    });
    queries.useUpdateSupplierEvidenceReminderSettingsMutation.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockRejectedValue({ status: 409 }),
    });
    queries.useSupplierEvidenceMetricsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: null,
    });
    queries.useSupplierEvidenceOverdueQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { overdue: [], nextCursor: null },
    });
    queries.useRetrySupplierEvidenceReminderMutation.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn(),
    });

    render(
      <SupplierEvidenceRemindersPanel
        supplierId="77777777-7777-4777-8777-777777777777"
        readEnabled
        canManage
      />,
    );

    const input = screen.getByLabelText("Reminder offsets in hours");
    fireEvent.change(input, { target: { value: "-72, -24, 24" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save reminder schedule" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          /changed elsewhere. Your entered offsets are still here/i,
        ),
      ).toBeInTheDocument(),
    );
    expect(input).toHaveValue("-72, -24, 24");
  });
});
