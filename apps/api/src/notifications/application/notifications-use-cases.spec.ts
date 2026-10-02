import { NotificationsUseCases } from "./notifications-use-cases";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const deliveryId = "44444444-4444-4444-8444-444444444444";

describe("notification application boundary", () => {
  it("passes scoped preference, route and delivery operations to its repository", async () => {
    const repository = {
      getPreferences: jest.fn().mockResolvedValue({ outcome: "found" }),
      updatePreferences: jest.fn().mockResolvedValue({ outcome: "updated" }),
      getCriticalRoute: jest.fn().mockResolvedValue({ outcome: "found" }),
      updateCriticalRoute: jest.fn().mockResolvedValue({ outcome: "updated" }),
      listDeliveries: jest.fn().mockResolvedValue({ outcome: "found" }),
      retryDelivery: jest.fn().mockResolvedValue({ outcome: "updated" }),
    };
    const useCases = new NotificationsUseCases(repository);
    const command = {
      expectedVersion: 1,
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
    };

    await useCases.getPreferences(organizationId, actorId);
    await useCases.updatePreferences(organizationId, actorId, command as never);
    await useCases.getCriticalRoute(organizationId, actorId, userId);
    await useCases.updateCriticalRoute(organizationId, actorId, userId, {
      ...command,
      alternateUserId: null,
    });
    await useCases.listDeliveries(organizationId, actorId, {
      limit: 50,
    });
    await useCases.retryDelivery(organizationId, actorId, deliveryId, command);

    expect(repository.getPreferences).toHaveBeenCalledWith(
      organizationId,
      actorId,
    );
    expect(repository.updatePreferences).toHaveBeenCalledWith(
      organizationId,
      actorId,
      command,
    );
    expect(repository.getCriticalRoute).toHaveBeenCalledWith(
      organizationId,
      actorId,
      userId,
    );
    expect(repository.updateCriticalRoute).toHaveBeenCalledWith(
      organizationId,
      actorId,
      userId,
      { ...command, alternateUserId: null },
    );
    expect(repository.listDeliveries).toHaveBeenCalledWith(
      organizationId,
      actorId,
      { limit: 50 },
    );
    expect(repository.retryDelivery).toHaveBeenCalledWith(
      organizationId,
      actorId,
      deliveryId,
      command,
    );
  });
});
