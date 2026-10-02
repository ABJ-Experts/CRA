import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { notificationDeliveryRefSchema } from "@repo/contracts/notifications";
import {
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  SELF_SCOPED_KEY,
  type RequestUser,
} from "../auth/auth.types";
import {
  NotificationsController,
  unwrapNotification,
} from "./notifications.controller";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const deliveryRef = notificationDeliveryRefSchema.parse("opaque_delivery_ref");
const user = { id: actorId, organizationId, role: "admin" } as RequestUser;

function metadata(key: string, method: string): unknown {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    NotificationsController.prototype,
    method,
  )?.value;
  expect(typeof handler).toBe("function");
  return Reflect.getMetadata(key, handler as object) as unknown;
}

describe("notification HTTP policy", () => {
  it("scopes self preferences, restricts critical routes, audit reads and retries", () => {
    expect(metadata(SELF_SCOPED_KEY, "preferences")).toBeTruthy();
    expect(metadata(SELF_SCOPED_KEY, "updatePreferences")).toBeTruthy();
    expect(metadata(REQUIRE_ROLE_KEY, "criticalRoute")).toBe("admin");
    expect(metadata(REQUIRE_ROLE_KEY, "updateCriticalRoute")).toBe("admin");
    expect(metadata(REQUIRE_PERMISSIONS_KEY, "updateCriticalRoute")).toEqual([
      "can_edit_organization",
    ]);
    expect(metadata(REQUIRE_PERMISSIONS_KEY, "deliveries")).toEqual([
      "can_view_audit",
    ]);
    expect(metadata(REQUIRE_PERMISSIONS_KEY, "retry")).toEqual([
      "can_edit_organization",
    ]);
  });

  it("passes only verified organization and actor to application commands", async () => {
    const useCases = {
      getPreferences: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      updatePreferences: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      getCriticalRoute: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      updateCriticalRoute: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      listDeliveries: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      retryDelivery: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
    };
    const controller = new NotificationsController(useCases as never);
    const revision = {
      expectedVersion: 1,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    };

    await controller.preferences(user);
    await controller.updatePreferences(revision as never, user);
    await controller.criticalRoute({ userId }, user);
    await controller.updateCriticalRoute(
      { userId },
      { ...revision, alternateUserId: null },
      user,
    );
    await controller.deliveries({ limit: 50 }, user);
    await controller.retry({ deliveryRef }, revision, user);

    expect(useCases.getPreferences).toHaveBeenCalledWith(
      organizationId,
      actorId,
    );
    expect(useCases.updatePreferences).toHaveBeenCalledWith(
      organizationId,
      actorId,
      revision,
    );
    expect(useCases.getCriticalRoute).toHaveBeenCalledWith(
      organizationId,
      actorId,
      userId,
    );
    expect(useCases.updateCriticalRoute).toHaveBeenCalledWith(
      organizationId,
      actorId,
      userId,
      { ...revision, alternateUserId: null },
    );
    expect(useCases.listDeliveries).toHaveBeenCalledWith(
      organizationId,
      actorId,
      { limit: 50 },
    );
    expect(useCases.retryDelivery).toHaveBeenCalledWith(
      organizationId,
      actorId,
      deliveryRef,
      revision,
    );
  });

  it("returns safe error semantics and refuses a missing organization", async () => {
    await expect(
      unwrapNotification(Promise.resolve({ outcome: "conflict" })),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      unwrapNotification(Promise.resolve({ outcome: "forbidden" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      unwrapNotification(Promise.resolve({ outcome: "not_found" })),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      unwrapNotification(Promise.resolve({ outcome: "invalid_request" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      unwrapNotification(Promise.reject(new Error("private SQL details"))),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const controller = new NotificationsController({} as never);
    expect(() =>
      controller.preferences({ ...user, organizationId: null }),
    ).toThrow(ForbiddenException);
  });
});
