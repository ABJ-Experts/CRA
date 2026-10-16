import { describe, expect, it } from "vitest";
import {
  notificationCategorySchema,
  notificationFeedQuerySchema,
  notificationFeedItemSchema,
  notificationFeedRefSchema,
  trustedNotificationRouteSchema,
} from "./notification.schema.js";
const ref = "m15_11111111-1111-4111-8111-111111111111_failure";
describe("source-owned backup assurance notices", () => {
  it("supports bounded, source-scoped health alerts without widening delivery preferences", () => {
    expect(
      notificationFeedQuerySchema.parse({ category: "backup_health" }).category,
    ).toBe("backup_health");
    expect(notificationCategorySchema.safeParse("backup_health").success).toBe(
      false,
    );
    expect(notificationFeedRefSchema.parse(ref)).toBe(ref);
    expect(
      notificationFeedItemSchema.parse({
        ref,
        category: "backup_health",
        severity: "critical",
        occurredAt: "2026-10-14T00:00:00.000Z",
        title: "Backup capture failed",
        summary: "A certified recovery point was not created.",
        read: false,
        fingerprint: "a".repeat(64),
        sourceState: "available",
        noticeKind: "failure",
      }).category,
    ).toBe("backup_health");
    expect(trustedNotificationRouteSchema.parse("/organization/health")).toBe(
      "/organization/health",
    );
    for (const route of [
      "https://support.example/",
      "/organization/health?token=canary",
      "/organization/health/../keys",
    ])
      expect(trustedNotificationRouteSchema.safeParse(route).success).toBe(
        false,
      );
  });
});
