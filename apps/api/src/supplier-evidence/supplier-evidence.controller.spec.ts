import type { RequestUser } from "../auth/auth.types";
import {
  SupplierEvidencePortalController,
  SupplierEvidenceRequestsController,
} from "./supplier-evidence.controller";

const organizationId = "00000000-0000-4000-8000-0000000000ca";
const user: RequestUser = {
  id: "00000000-0000-4000-8000-000000000001",
  authUserId: "00000000-0000-4000-8000-000000000002",
  email: "owner@cra.test",
  isActive: true,
  organizationId,
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
};

describe("SupplierEvidenceRequestsController reminder routes", () => {
  const evidence = {
    list: jest.fn(),
    getReminderSettings: jest.fn(),
    updateReminderSettings: jest.fn(),
    metrics: jest.fn(),
    overdue: jest.fn(),
    retryReminderDelivery: jest.fn(),
  };
  const controller = new SupplierEvidenceRequestsController(
    evidence as never,
    {} as never,
  );

  beforeEach(() => jest.resetAllMocks());

  it("passes verified actor and organization scope through metrics and overdue reads", async () => {
    evidence.metrics.mockResolvedValue({ metrics: true });
    evidence.overdue.mockResolvedValue({ overdue: [], nextCursor: null });

    const metrics = await controller.metrics(
      { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
      user,
    );
    const overdue = await controller.overdue({ limit: 25 }, user);

    expect(evidence.metrics).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ actorId: user.id }),
    );
    expect(evidence.overdue).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ actorId: user.id, limit: 25 }),
    );
    expect(metrics).toEqual({ summary: { metrics: true } });
    expect(overdue).toEqual({ overdue: [], nextCursor: null });
  });

  it("maps an asynchronously failed scoped list to a safe service error", async () => {
    evidence.list.mockRejectedValue(new Error("database detail"));

    await expect(controller.list({ limit: 25 }, user)).rejects.toMatchObject({
      status: 503,
      response: {
        code: "unavailable",
        message: "Supplier evidence is temporarily unavailable.",
      },
    });
  });

  it("requires request-bound optimistic data when retrying a reminder", async () => {
    evidence.retryReminderDelivery.mockResolvedValue({ id: "delivery" });

    const response = await controller.retryReminderDelivery(
      {
        requestId: "00000000-0000-4000-8000-000000000003",
        deliveryId: "00000000-0000-4000-8000-000000000004",
      },
      {
        expectedVersion: 4,
        idempotencyKey: "00000000-0000-4000-8000-000000000005",
      },
      user,
    );

    expect(evidence.retryReminderDelivery).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({
        actorId: user.id,
        requestId: "00000000-0000-4000-8000-000000000003",
        deliveryId: "00000000-0000-4000-8000-000000000004",
        expectedVersion: 4,
      }),
    );
    expect(response).toEqual({ delivery: { id: "delivery" } });
  });
});

describe("SupplierEvidencePortalController request", () => {
  it("maps an asynchronously rejected revoked session to an unavailable link", async () => {
    const evidence = {
      portalRequest: jest.fn().mockRejectedValue(new Error("revoked grant")),
    };
    const controller = new SupplierEvidencePortalController(evidence as never);

    await expect(controller.request("revoked-session")).rejects.toMatchObject({
      status: 404,
      response: {
        code: "not_found",
        message: "This supplier portal link is unavailable.",
      },
    });
  });
});
