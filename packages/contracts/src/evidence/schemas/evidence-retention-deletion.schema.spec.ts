import { describe, expect, it } from "vitest";

import {
  createEvidenceDeletionIntentInputSchema,
  evidenceLegalHoldSchema,
  evidenceRetentionReviewResponseSchema,
  placeEvidenceLegalHoldInputSchema,
  releaseEvidenceLegalHoldInputSchema,
} from "./evidence-retention-deletion.schema.js";

const documentId = "00000000-0000-4000-8000-000000000001";
const versionId = "00000000-0000-4000-8000-000000000002";
const holdId = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";
const idempotencyKey = "00000000-0000-4000-8000-000000000005";

describe("evidence retention and deletion schema boundaries", () => {
  it("accepts an eligible review with an explicit immutable review fingerprint", () => {
    expect(
      evidenceRetentionReviewResponseSchema.parse({
        review: {
          documentId,
          currentVersionId: versionId,
          lifecycle: "active",
          reviewedAt: "2026-09-21T10:00:00.000Z",
          reviewFingerprint: "a".repeat(64),
          eligibleForDeletion: true,
          blockers: [],
          protection: {
            status: "current",
            retentionUntil: "2026-09-20T00:00:00.000Z",
            retentionProtectionUntil: "2026-09-20T00:00:00.000Z",
            legalHoldActive: false,
            identityHandling: "none",
          },
        },
      }),
    ).toMatchObject({ review: { eligibleForDeletion: true } });
  });

  it("requires a generic restricted blocker instead of leaking hidden references", () => {
    expect(
      evidenceRetentionReviewResponseSchema.parse({
        review: {
          documentId,
          currentVersionId: versionId,
          lifecycle: "active",
          reviewedAt: "2026-09-21T10:00:00.000Z",
          reviewFingerprint: "a".repeat(64),
          eligibleForDeletion: false,
          blockers: [
            {
              visibility: "restricted",
              kind: "protected_reference",
              message: "A protected related record prevents deletion.",
            },
          ],
          protection: {
            status: "incomplete",
            retentionUntil: null,
            retentionProtectionUntil: null,
            legalHoldActive: false,
            identityHandling: "legal_review_required",
          },
        },
      }).review.blockers[0],
    ).toMatchObject({ visibility: "restricted" });
  });

  it("rejects eligibility while a blocker is present or a cleanup lifecycle is active", () => {
    const review = {
      documentId,
      currentVersionId: versionId,
      lifecycle: "active",
      reviewedAt: "2026-09-21T10:00:00.000Z",
      reviewFingerprint: "a".repeat(64),
      eligibleForDeletion: true,
      blockers: [
        {
          visibility: "visible",
          kind: "product_retention",
          obligation: "Product retention",
          productId: "00000000-0000-4000-8000-000000000006",
          productName: "Gateway",
          protectThrough: "2030-01-01T00:00:00.000Z",
        },
      ],
      protection: {
        status: "current",
        retentionUntil: "2030-01-01T00:00:00.000Z",
        retentionProtectionUntil: "2030-01-01T00:00:00.000Z",
        legalHoldActive: false,
        identityHandling: "none",
      },
    };
    expect(() => evidenceRetentionReviewResponseSchema.parse({ review })).toThrow();
    expect(() =>
      evidenceRetentionReviewResponseSchema.parse({
        review: { ...review, blockers: [], lifecycle: "cleanup_queued" },
      }),
    ).toThrow();
  });

  it("requires a fresh review, current version, explicit confirmation, reason, and idempotency key", () => {
    const input = {
      expectedCurrentVersionId: versionId,
      reviewFingerprint: "b".repeat(64),
      confirmed: true,
      reason: "The evidence is no longer required after review.",
      idempotencyKey,
    };
    expect(createEvidenceDeletionIntentInputSchema.parse(input)).toEqual(input);
    expect(() =>
      createEvidenceDeletionIntentInputSchema.parse({ ...input, confirmed: false }),
    ).toThrow();
    expect(() =>
      createEvidenceDeletionIntentInputSchema.parse({ ...input, reason: " " }),
    ).toThrow();
  });

  it("keeps multiple legal holds independently releasable and fully audited", () => {
    const active = {
      id: holdId,
      documentId,
      reason: "Preserve for regulator request.",
      status: "active",
      placedByUserId: actorId,
      placedAt: "2026-09-21T10:00:00.000Z",
      releasedByUserId: null,
      releasedAt: null,
      releaseReason: null,
    };
    expect(evidenceLegalHoldSchema.parse(active)).toMatchObject({ status: "active" });
    expect(
      evidenceLegalHoldSchema.parse({
        ...active,
        status: "released",
        releasedByUserId: "00000000-0000-4000-8000-000000000007",
        releasedAt: "2026-09-22T10:00:00.000Z",
        releaseReason: "Matter closed.",
      }),
    ).toMatchObject({ status: "released" });
    expect(() =>
      evidenceLegalHoldSchema.parse({ ...active, status: "released" }),
    ).toThrow();
    expect(
      placeEvidenceLegalHoldInputSchema.parse({
        reason: active.reason,
        idempotencyKey,
      }),
    ).toMatchObject({ reason: active.reason });
    expect(
      releaseEvidenceLegalHoldInputSchema.parse({
        reason: "Matter closed.",
        idempotencyKey,
      }),
    ).toMatchObject({ reason: "Matter closed." });
  });
});
