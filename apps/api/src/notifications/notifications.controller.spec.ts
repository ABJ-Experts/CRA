import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  notificationDeliveryRefSchema,
  notificationFeedRefSchema,
} from "@repo/contracts/notifications";
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
const chatChannelId = "44444444-4444-4444-8444-444444444444";
const chatDeliveryId = "55555555-5555-4555-8555-555555555555";
const feedRef = notificationFeedRefSchema.parse(`m6_${organizationId}_event`);
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
    expect(metadata(REQUIRE_PERMISSIONS_KEY, "burstBatches")).toEqual([
      "can_view_audit",
    ]);
    expect(metadata(REQUIRE_PERMISSIONS_KEY, "retry")).toEqual([
      "can_edit_organization",
    ]);
    for (const method of [
      "chatChannels",
      "createChatChannel",
      "updateChatChannel",
      "testChatChannel",
      "confirmChatChannel",
      "enableChatChannel",
      "retryChatDelivery",
    ]) {
      expect(metadata(REQUIRE_ROLE_KEY, method)).toBe("admin");
      expect(metadata(REQUIRE_PERMISSIONS_KEY, method)).toEqual([
        "can_edit_organization",
      ]);
    }
    expect(metadata(REQUIRE_PERMISSIONS_KEY, "chatDeliveries")).toEqual([
      "can_view_audit",
    ]);
    for (const method of ["burstPolicy", "updateBurstPolicy"]) {
      expect(metadata(REQUIRE_ROLE_KEY, method)).toBe("admin");
      expect(metadata(REQUIRE_PERMISSIONS_KEY, method)).toEqual([
        "can_edit_organization",
      ]);
    }
    for (const method of [
      "feed",
      "feedUnreadCount",
      "feedDestination",
      "markFeedRead",
    ]) {
      expect(metadata(SELF_SCOPED_KEY, method)).toBeTruthy();
    }
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
      listBurstBatches: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      retryDelivery: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      listFeed: jest.fn().mockResolvedValue({ outcome: "found", data: {} }),
      countFeedUnread: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      resolveFeedDestination: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      markFeedRead: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      listChatChannels: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      createChatChannel: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      updateChatChannel: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      testChatChannel: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      confirmChatChannel: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      enableChatChannel: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      listChatDeliveries: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      retryChatDelivery: jest
        .fn()
        .mockResolvedValue({ outcome: "updated", data: {} }),
      getBurstPolicy: jest
        .fn()
        .mockResolvedValue({ outcome: "found", data: {} }),
      updateBurstPolicy: jest
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
    await controller.burstBatches({ limit: 25 }, user);
    await controller.retry({ deliveryRef }, revision, user);
    const query = { limit: 25, read: "all" as const };
    const command = {
      items: [{ ref: feedRef, expectedFingerprint: "a".repeat(64) }],
      idempotencyKey: revision.idempotencyKey,
    };
    await controller.feed(query, user);
    await controller.feedUnreadCount(user);
    await controller.feedDestination({ ref: feedRef }, user);
    await controller.markFeedRead(command, user);
    const chatChannelInput = {
      name: "Security alerts",
      provider: "slack",
      target: { url: "https://hooks.slack.test/services/abc" },
      idempotencyKey: revision.idempotencyKey,
    };
    const chatChannelPatch = {
      expectedVersion: 1,
      name: "Security alerts",
      target: { url: "https://hooks.slack.test/services/def" },
      idempotencyKey: revision.idempotencyKey,
    };
    const testInput = {
      expectedVersion: 1,
      idempotencyKey: revision.idempotencyKey,
    };
    const confirmInput = {
      expectedVersion: 1,
      testId: chatDeliveryId,
      code: "123456",
      idempotencyKey: revision.idempotencyKey,
    };
    const enableInput = {
      expectedVersion: 1,
      enabled: true,
      idempotencyKey: revision.idempotencyKey,
    };
    await controller.chatChannels(user);
    await controller.createChatChannel(chatChannelInput as never, user);
    await controller.updateChatChannel(
      { channelId: chatChannelId },
      chatChannelPatch as never,
      user,
    );
    await controller.testChatChannel(
      { channelId: chatChannelId },
      testInput,
      user,
    );
    await controller.confirmChatChannel(
      { channelId: chatChannelId },
      confirmInput,
      user,
    );
    await controller.enableChatChannel(
      { channelId: chatChannelId },
      enableInput,
      user,
    );
    await controller.chatDeliveries({ limit: 20 }, user);
    await controller.retryChatDelivery(
      { deliveryId: chatDeliveryId },
      revision,
      user,
    );
    await controller.burstPolicy(user);
    await controller.updateBurstPolicy({ ...revision, enabled: true }, user);

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
    expect(useCases.listBurstBatches).toHaveBeenCalledWith(
      organizationId,
      actorId,
      { limit: 25 },
    );
    expect(useCases.retryDelivery).toHaveBeenCalledWith(
      organizationId,
      actorId,
      deliveryRef,
      revision,
    );
    expect(useCases.listFeed).toHaveBeenCalledWith(
      organizationId,
      actorId,
      query,
    );
    expect(useCases.countFeedUnread).toHaveBeenCalledWith(
      organizationId,
      actorId,
    );
    expect(useCases.resolveFeedDestination).toHaveBeenCalledWith(
      organizationId,
      actorId,
      feedRef,
    );
    expect(useCases.markFeedRead).toHaveBeenCalledWith(
      organizationId,
      actorId,
      command,
    );
    expect(useCases.listChatChannels).toHaveBeenCalledWith(
      organizationId,
      actorId,
    );
    expect(useCases.createChatChannel).toHaveBeenCalledWith(
      organizationId,
      actorId,
      chatChannelInput,
    );
    expect(useCases.updateChatChannel).toHaveBeenCalledWith(
      organizationId,
      actorId,
      chatChannelId,
      chatChannelPatch,
    );
    expect(useCases.testChatChannel).toHaveBeenCalledWith(
      organizationId,
      actorId,
      chatChannelId,
      testInput,
    );
    expect(useCases.confirmChatChannel).toHaveBeenCalledWith(
      organizationId,
      actorId,
      chatChannelId,
      confirmInput,
    );
    expect(useCases.enableChatChannel).toHaveBeenCalledWith(
      organizationId,
      actorId,
      chatChannelId,
      enableInput,
    );
    expect(useCases.listChatDeliveries).toHaveBeenCalledWith(
      organizationId,
      actorId,
      { limit: 20 },
    );
    expect(useCases.retryChatDelivery).toHaveBeenCalledWith(
      organizationId,
      actorId,
      chatDeliveryId,
      revision,
    );
    expect(useCases.getBurstPolicy).toHaveBeenCalledWith(
      organizationId,
      actorId,
    );
    expect(useCases.updateBurstPolicy).toHaveBeenCalledWith(
      organizationId,
      actorId,
      { ...revision, enabled: true },
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
