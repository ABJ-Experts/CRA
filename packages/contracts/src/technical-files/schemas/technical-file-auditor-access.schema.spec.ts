import { describe, expect, it } from "vitest";

import {
  createTechnicalFileAuditorGrantRequestSchema,
  technicalFileAuditorAccessUnavailableResponseSchema,
  technicalFileAuditorGrantTokenSchema,
} from "./technical-file-auditor-access.schema.js";

const id = "00000000-0000-4000-8000-000000000001";

describe("technical-file auditor access contract boundaries", () => {
  it("requires a recipient, purpose, expiry and idempotency key", () => {
    expect(() =>
      createTechnicalFileAuditorGrantRequestSchema.parse({
        exportId: id,
        recipientEmail: "not-an-email",
        purpose: "",
        expiresAt: "not-a-date",
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("normalizes the recipient email without accepting unknown fields", () => {
    expect(
      createTechnicalFileAuditorGrantRequestSchema.parse({
        exportId: id,
        recipientEmail: "AUDITOR@EXAMPLE.TEST",
        recipientReference: null,
        purpose: "Independent conformity assessment",
        expiresAt: "2026-10-01T10:00:00.000Z",
        idempotencyKey: id,
      }),
    ).toMatchObject({ recipientEmail: "auditor@example.test" });
  });

  it("accepts only high-entropy opaque magic-link tokens", () => {
    expect(technicalFileAuditorGrantTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(technicalFileAuditorGrantTokenSchema.safeParse(id).success).toBe(false);
  });

  it("keeps unavailable responses free of snapshot or product details", () => {
    expect(
      technicalFileAuditorAccessUnavailableResponseSchema.parse({
        status: "revoked",
        message: "This auditor access is unavailable.",
      }),
    ).toEqual({ status: "revoked", message: "This auditor access is unavailable." });
    expect(() =>
      technicalFileAuditorAccessUnavailableResponseSchema.parse({
        status: "revoked",
        message: "This auditor access is unavailable.",
        productId: id,
      }),
    ).toThrow();
  });
});
