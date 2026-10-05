import { describe, expect, it } from "vitest";

import {
  chatChannelMutationResponseSchema,
  chatChannelParamsSchema,
  chatChannelTestResponseSchema,
  chatChannelsResponseSchema,
  chatDeliveriesQuerySchema,
  chatDeliveriesResponseSchema,
  chatDeliveryMutationResponseSchema,
  chatDeliveryParamsSchema,
  confirmChatChannelInputSchema,
  createChatChannelInputSchema,
  retryChatDeliveryInputSchema,
  setChatChannelEnabledInputSchema,
  testChatChannelInputSchema,
  updateChatChannelInputSchema,
} from "./chat.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const orgId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const key = "00000000-0000-4000-8000-000000000004";
const time = "2026-10-02T00:00:00Z";
const common = {
  displayName: "Regulatory alerts",
  eventClasses: ["high_severity_alert", "countdown_warning"],
  productIds: [productId],
  idempotencyKey: key,
};
const channel = {
  id,
  organizationId: orgId,
  mode: "slack_webhook",
  displayName: common.displayName,
  eventClasses: common.eventClasses,
  productIds: common.productIds,
  includeOrganizationWide: false,
  enabled: false,
  verified: false,
  safeErrorCode: null,
  version: 1,
  createdAt: time,
  updatedAt: time,
};

describe("chat notification wire contracts", () => {
  it("accepts only explicit, unique routing scopes and mode-specific credentials", () => {
    const destinations = [
      {
        mode: "slack_webhook",
        webhookUrl: "https://hooks.slack.com/services/T000/B000/secret",
      },
      { mode: "slack_bot", botToken: "xoxb-example", channelId: "C123456789" },
      {
        mode: "teams_workflow_webhook",
        webhookUrl:
          "https://example.api.powerplatform.com/workflows/secret?sig=value",
      },
      {
        mode: "teams_bot_proactive",
        tenantId: orgId,
        appId: id,
        clientSecret: "example-secret",
        serviceUrl: "https://smba.trafficmanager.net/emea/",
        conversationId: "19:conversation@thread.tacv2",
      },
    ];
    for (const destination of destinations) {
      expect(
        createChatChannelInputSchema.safeParse({ ...common, destination })
          .success,
      ).toBe(true);
    }
    const signedWorkflowUrl =
      "https://example.api.powerplatform.com/workflows/secret?sig=Ab%2Fcd+Ef";
    expect(
      createChatChannelInputSchema.parse({
        ...common,
        destination: {
          mode: "teams_workflow_webhook",
          webhookUrl: signedWorkflowUrl,
        },
      }).destination,
    ).toEqual({
      mode: "teams_workflow_webhook",
      webhookUrl: signedWorkflowUrl,
    });
    expect(
      createChatChannelInputSchema.safeParse({
        ...common,
        productIds: [productId, productId],
        destination: destinations[0],
      }).success,
    ).toBe(false);
    expect(
      createChatChannelInputSchema.safeParse({
        ...common,
        productIds: [],
        destination: destinations[0],
      }).success,
    ).toBe(false);
    expect(
      createChatChannelInputSchema.safeParse({
        ...common,
        productIds: [],
        includeOrganizationWide: true,
        destination: destinations[0],
      }).success,
    ).toBe(true);
    expect(
      createChatChannelInputSchema.safeParse({
        ...common,
        eventClasses: [],
        destination: destinations[0],
      }).success,
    ).toBe(false);
    expect(
      createChatChannelInputSchema.safeParse({
        ...common,
        displayName: "@everyone <script>\nalert",
        destination: destinations[0],
      }).success,
    ).toBe(false);
    expect(
      createChatChannelInputSchema.safeParse({
        ...common,
        displayName: "Échéances réglementaires (EU)",
        destination: destinations[0],
      }).success,
    ).toBe(true);
    expect(
      createChatChannelInputSchema.safeParse({
        ...common,
        destination: { ...destinations[0], botToken: "secret" },
      }).success,
    ).toBe(false);
    expect(
      createChatChannelInputSchema.safeParse({
        ...common,
        destination: {
          mode: "slack_webhook",
          webhookUrl: "http://127.0.0.1/secret",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps credentials write-only on channel responses", () => {
    expect(
      chatChannelsResponseSchema.safeParse({ channels: [channel] }).success,
    ).toBe(true);
    expect(
      chatChannelMutationResponseSchema.safeParse({ channel }).success,
    ).toBe(true);
    expect(
      chatChannelMutationResponseSchema.safeParse({
        channel: { ...channel, safeErrorCode: "route_admin_revoked" },
      }).success,
    ).toBe(true);
    expect(
      chatChannelMutationResponseSchema.safeParse({
        channel: { ...channel, safeErrorCode: "Bearer secret" },
      }).success,
    ).toBe(false);
    const withoutSafeCode = Object.fromEntries(
      Object.entries(channel).filter(([key]) => key !== "safeErrorCode"),
    );
    expect(
      chatChannelMutationResponseSchema.safeParse({ channel: withoutSafeCode })
        .success,
    ).toBe(false);
    expect(
      chatChannelMutationResponseSchema.safeParse({
        channel: { ...channel, webhookUrl: "https://secret.test" },
      }).success,
    ).toBe(false);
    expect(chatChannelParamsSchema.safeParse({ channelId: id }).success).toBe(
      true,
    );
    expect(
      chatChannelParamsSchema.safeParse({ channelId: "../other" }).success,
    ).toBe(false);
  });

  it("requires optimistic, idempotent updates and destination confirmation", () => {
    expect(
      updateChatChannelInputSchema.safeParse({
        ...common,
        expectedVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      updateChatChannelInputSchema.safeParse({
        ...common,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      testChatChannelInputSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey: key,
      }).success,
    ).toBe(true);
    expect(
      chatChannelTestResponseSchema.safeParse({
        testId: id,
        expiresAt: time,
        status: "provider_accepted",
      }).success,
    ).toBe(true);
    expect(
      confirmChatChannelInputSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey: key,
        testId: id,
        code: "123456",
      }).success,
    ).toBe(true);
    expect(
      confirmChatChannelInputSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey: key,
        testId: id,
        code: "1234567",
      }).success,
    ).toBe(false);
    expect(
      setChatChannelEnabledInputSchema.safeParse({
        expectedVersion: 1,
        idempotencyKey: key,
        enabled: true,
      }).success,
    ).toBe(true);
  });

  it("bounds delivery history and exposes only safe outcomes", () => {
    expect(chatDeliveriesQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(chatDeliveriesQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(chatDeliveriesQuerySchema.safeParse({ limit: "51" }).success).toBe(
      false,
    );
    expect(
      chatDeliveriesQuerySchema.safeParse({ cursor: "../unsafe" }).success,
    ).toBe(false);
    const delivery = {
      id,
      channelId: id,
      eventClass: "countdown_warning",
      status: "uncertain",
      sourceType: "reporting_obligation",
      sourceId: id,
      sourceRevision: "2",
      attemptCount: 1,
      lastAttemptAt: time,
      nextAttemptAt: null,
      safeErrorCode: "ambiguous_acceptance",
      createdAt: time,
      updatedAt: time,
      version: 2,
    };
    expect(
      chatDeliveriesResponseSchema.safeParse({
        rows: [delivery],
        nextCursor: null,
      }).success,
    ).toBe(true);
    expect(
      chatDeliveryMutationResponseSchema.safeParse({ delivery }).success,
    ).toBe(true);
    expect(
      chatDeliveryMutationResponseSchema.safeParse({
        delivery: { ...delivery, providerResponse: "private content" },
      }).success,
    ).toBe(false);
    expect(chatDeliveryParamsSchema.safeParse({ deliveryId: id }).success).toBe(
      true,
    );
    expect(
      retryChatDeliveryInputSchema.safeParse({
        expectedVersion: 2,
        idempotencyKey: key,
      }).success,
    ).toBe(true);
  });
});
