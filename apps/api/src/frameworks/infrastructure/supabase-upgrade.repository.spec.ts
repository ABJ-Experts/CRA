import { ServiceUnavailableException } from "@nestjs/common";
import type { SupabaseService } from "../../supabase/supabase.service";
import {
  UpgradeBlockedError,
  UpgradeConflictError,
  UpgradeForbiddenError,
  UpgradeInvalidRequestError,
  UpgradeNotFoundError,
} from "../application/upgrade-use-cases";
import { SupabaseUpgradeRepository } from "./supabase-upgrade.repository";

describe("SupabaseUpgradeRepository", () => {
  const rpc = jest.fn();
  const repository = new SupabaseUpgradeRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);
  const reviewId = "cd4ece97-f5ef-4b60-940c-19c28c2a37f0";
  const idempotencyKey = "8957bdae-86d9-4e56-a0e4-70d9d449fc15";

  beforeEach(() => rpc.mockReset());

  it("passes verified scope and empty keys for an explicit gap", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "recorded", result: { reviewId, revision: 2 } }],
      error: null,
    });
    await expect(
      repository.decide("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        reviewId,
        mappingId: "cd5ece97-f5ef-4b60-940c-19c28c2a37f0",
        action: "leave_gap",
        targetRequirementKeys: [],
        expectedReviewRevision: 1,
        idempotencyKey,
      }),
    ).resolves.toEqual({ reviewId, revision: 2 });
    expect(rpc).toHaveBeenCalledWith("m10_set_upgrade_decision", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_review_id: reviewId,
      p_mapping_id: "cd5ece97-f5ef-4b60-940c-19c28c2a37f0",
      p_target_keys: [],
      p_expected_review_revision: 1,
      p_idempotency_key: idempotencyKey,
    });
  });

  it.each([
    ["conflict", UpgradeConflictError],
    ["forbidden", UpgradeForbiddenError],
  ])("maps %s from an atomic upgrade", async (outcome, expected) => {
    rpc.mockResolvedValue({ data: [{ outcome, result: null }], error: null });
    await expect(
      repository.commit("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        reviewId,
        expectedReviewRevision: 2,
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(expected);
  });

  it("parses the audited selection and counts from a successful commit", async () => {
    const result = {
      reviewId,
      selection: {
        packKey: "cra",
        versionKey: "2025",
        enabled: true,
        revision: 2,
      },
      migratedCount: 3,
      gapCount: 1,
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "upgraded", result }],
      error: null,
    });
    await expect(
      repository.commit("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        reviewId,
        expectedReviewRevision: 2,
        idempotencyKey,
      }),
    ).resolves.toEqual(result);
    expect(rpc).toHaveBeenCalledWith("m10_commit_upgrade", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_review_id: reviewId,
      p_expected_review_revision: 2,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("hides provider failure behind service unavailable", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "internal SQL detail" },
    });
    await expect(
      repository.commit("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        reviewId,
        expectedReviewRevision: 2,
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("rejects malformed successful SQL output before serialization", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "listed",
          result: {
            relations: [{ id: "bad", curated: true }],
            nextCursor: null,
          },
        },
      ],
      error: null,
    });
    await expect(
      repository.crosswalks("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        versionKey: "2024",
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("passes an opaque bounded cursor and exact version scope to the crosswalk RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        { outcome: "listed", result: { relations: [], nextCursor: null } },
      ],
      error: null,
    });
    const cursor = Buffer.from("50").toString("base64url");
    await expect(
      repository.crosswalks("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        versionKey: "2024",
        limit: 50,
        cursor,
      }),
    ).resolves.toEqual({ relations: [], nextCursor: null });
    expect(rpc).toHaveBeenCalledWith("m10_crosswalk_page", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_pack_key: "cra",
      p_version_key: "2024",
      p_limit: 50,
      p_offset: 50,
    });
  });

  it("rejects a noncanonical cursor before reading", async () => {
    await expect(
      repository.crosswalks("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        versionKey: "2024",
        limit: 50,
        cursor: "MDA", // 00, not canonical decimal
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("scopes evidence reuse to one product and evidence version", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "listed",
          result: {
            relations: [],
            evidenceValid: false,
            nextCursor: null,
          },
        },
      ],
      error: null,
    });
    await repository.evidenceReuse("org-a", {
      actorId: "actor-a",
      evidenceVersionId: "7ee2898b-0b4e-4679-983e-d00ab71c7c9a",
      productId: "0bc832c7-3e21-4624-a7fa-6ffef9ed0c9c",
      limit: 10,
    });
    expect(rpc).toHaveBeenCalledWith("m10_crosswalk_evidence_reuse", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_evidence_version_id: "7ee2898b-0b4e-4679-983e-d00ab71c7c9a",
      p_product_id: "0bc832c7-3e21-4624-a7fa-6ffef9ed0c9c",
      p_limit: 10,
      p_offset: 0,
    });
  });

  it("returns a paged preview only for its requested target", async () => {
    const cursor = "08c02b2e-80ea-4823-91d2-a7aa14a90ffb";
    const preview = {
      packKey: "cra",
      sourceVersionKey: "2024",
      targetVersionKey: "2025",
      selectionRevision: 1,
      sourceHash: "a".repeat(64),
      targetHash: "b".repeat(64),
      fingerprint: "c".repeat(64),
      diff: { added: [], removed: [], changed: [], split: [], merged: [] },
      impacts: [],
      nextCursor: null,
      totalImpacts: 0,
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "previewed", result: preview }],
      error: null,
    });
    await expect(
      repository.preview("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        targetVersionKey: "2025",
        limit: 10,
        cursor,
      }),
    ).resolves.toEqual(preview);
    expect(rpc).toHaveBeenCalledWith("m10_upgrade_preview", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_pack_key: "cra",
      p_target_version_key: "2025",
      p_limit: 10,
      p_cursor: cursor,
    });
    await expect(
      repository.preview("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        targetVersionKey: "2025",
        limit: 10,
        cursor: "not-a-uuid",
      }),
    ).rejects.toThrow();
  });

  it("creates and retrieves a review under the same pack scope", async () => {
    const summary = {
      reviewId,
      packKey: "cra",
      sourceVersionKey: "2024",
      targetVersionKey: "2025",
      revision: 1,
      status: "draft",
    };
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "created", result: summary }],
      error: null,
    });
    await expect(
      repository.createReview("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        targetVersionKey: "2025",
        expectedSelectionRevision: 1,
        idempotencyKey,
      }),
    ).resolves.toEqual(summary);
    expect(rpc).toHaveBeenCalledWith("m10_create_upgrade_review", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_pack_key: "cra",
      p_target_version_key: "2025",
      p_expected_selection_revision: 1,
      p_idempotency_key: idempotencyKey,
    });
    const page = { ...summary, decisions: [], nextCursor: null };
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "listed", result: page }],
      error: null,
    });
    await expect(
      repository.review("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        reviewId,
        limit: 10,
      }),
    ).resolves.toEqual(page);
    expect(rpc).toHaveBeenCalledWith("m10_upgrade_review_page", {
      p_organization_id: "org-a",
      p_actor_user_id: "actor-a",
      p_review_id: reviewId,
      p_limit: 10,
      p_offset: 0,
    });
  });

  it.each([
    ["invalid_request", UpgradeInvalidRequestError],
    ["not_found", UpgradeNotFoundError],
    ["blocked", UpgradeBlockedError],
    ["upgrade_required", UpgradeConflictError],
  ])("maps %s without exposing internal SQL", async (outcome, expected) => {
    rpc.mockResolvedValue({ data: [{ outcome, result: null }], error: null });
    await expect(
      repository.commit("org-a", {
        actorId: "actor-a",
        packKey: "cra",
        reviewId,
        expectedReviewRevision: 1,
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(expected);
  });
});
