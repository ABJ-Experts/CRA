import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  UpgradeBlockedError,
  UpgradeConflictError,
  UpgradeForbiddenError,
  UpgradeInvalidRequestError,
  UpgradeNotFoundError,
  UpgradeUseCases,
} from "./application/upgrade-use-cases";
import { UpgradesController } from "./upgrades.controller";

describe("UpgradesController", () => {
  const preview = jest.fn();
  const commit = jest.fn();
  const crosswalks = jest.fn();
  const createReview = jest.fn();
  const review = jest.fn();
  const decide = jest.fn();
  const evidenceReuse = jest.fn();
  const controller = new UpgradesController({
    preview,
    commit,
    crosswalks,
    createReview,
    review,
    decide,
    evidenceReuse,
  } as unknown as UpgradeUseCases);
  const user = { id: "actor-a", organizationId: "org-a" } as RequestUser;

  beforeEach(() => jest.clearAllMocks());

  it("gates migration effects behind framework, product, and evidence permissions", () => {
    const permissions = (handlerName: string): unknown => {
      const handler: unknown = Reflect.get(controller, handlerName);
      if (typeof handler !== "function")
        throw new Error("Missing route handler");
      return Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler);
    };
    const manage = [
      "can_view_frameworks",
      "can_manage_frameworks",
      "can_view_products",
      "can_view_evidence",
    ];
    for (const handlerName of [
      "preview",
      "createReview",
      "review",
      "decide",
      "commit",
    ]) {
      expect(permissions(handlerName)).toEqual(manage);
    }
    expect(permissions("crosswalks")).toEqual(["can_view_frameworks"]);
    expect(permissions("evidenceReuse")).toEqual([
      "can_view_frameworks",
      "can_view_products",
      "can_view_evidence",
    ]);
  });

  it("uses verified identity rather than caller supplied scope", async () => {
    preview.mockResolvedValue({ impacts: [] });
    await controller.preview(
      { packKey: "cra", targetVersionKey: "2025" },
      { limit: 10 },
      user,
    );
    expect(preview).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      packKey: "cra",
      targetVersionKey: "2025",
      limit: 10,
    });
  });

  it("rejects absent organization before invoking the use case", async () => {
    await expect(
      controller.preview(
        { packKey: "cra", targetVersionKey: "2025" },
        { limit: 10 },
        { ...user, organizationId: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(preview).not.toHaveBeenCalled();
  });

  it("returns stale commit as a conflict", async () => {
    commit.mockRejectedValue(new UpgradeConflictError());
    await expect(
      controller.commit(
        { packKey: "cra", reviewId: "7c2010bb-3104-40a3-9d19-9f04b9446881" },
        {
          expectedReviewRevision: 2,
          idempotencyKey: "1d036c10-6dc1-44ee-bc5f-5a55329a70ab",
        },
        user,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("routes crosswalk and evidence reads with independently scoped product input", async () => {
    crosswalks.mockResolvedValue({ relations: [], nextCursor: null });
    evidenceReuse.mockResolvedValue({
      relations: [],
      evidenceValid: false,
      nextCursor: null,
    });
    await controller.crosswalks(
      { packKey: "cra", versionKey: "2024" },
      { limit: 20 },
      user,
    );
    await controller.evidenceReuse(
      { evidenceVersionId: "ee5784ec-3063-4555-b9d5-0a4b43271193" },
      { productId: "c47a16cf-2b5f-4844-b1ba-2e1f44f4228a", limit: 20 },
      user,
    );
    expect(crosswalks).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      packKey: "cra",
      versionKey: "2024",
      limit: 20,
    });
    expect(evidenceReuse).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      evidenceVersionId: "ee5784ec-3063-4555-b9d5-0a4b43271193",
      productId: "c47a16cf-2b5f-4844-b1ba-2e1f44f4228a",
      limit: 20,
    });
  });

  it("routes review creation, paged reading, decisions, and commit with verified scope", async () => {
    const reviewId = "7c2010bb-3104-40a3-9d19-9f04b9446881";
    const mappingId = "1c2010bb-3104-40a3-9d19-9f04b9446881";
    const idempotencyKey = "1d036c10-6dc1-44ee-bc5f-5a55329a70ab";
    createReview.mockResolvedValue({ reviewId });
    review.mockResolvedValue({ reviewId });
    decide.mockResolvedValue({ reviewId, revision: 2 });
    commit.mockResolvedValue({ reviewId });
    await controller.createReview(
      { packKey: "cra" },
      {
        targetVersionKey: "2025",
        expectedSelectionRevision: 1,
        idempotencyKey,
      },
      user,
    );
    await controller.review({ packKey: "cra", reviewId }, { limit: 20 }, user);
    await controller.decide(
      { packKey: "cra", reviewId, mappingId },
      {
        action: "leave_gap",
        targetRequirementKeys: [],
        expectedReviewRevision: 1,
        idempotencyKey,
      },
      user,
    );
    await controller.commit(
      { packKey: "cra", reviewId },
      {
        expectedReviewRevision: 2,
        idempotencyKey,
      },
      user,
    );
    expect(createReview).toHaveBeenCalledWith(
      "org-a",
      expect.objectContaining({
        actorId: "actor-a",
        packKey: "cra",
        targetVersionKey: "2025",
      }),
    );
    expect(review).toHaveBeenCalledWith("org-a", {
      actorId: "actor-a",
      packKey: "cra",
      reviewId,
      limit: 20,
    });
    expect(decide).toHaveBeenCalledWith(
      "org-a",
      expect.objectContaining({
        actorId: "actor-a",
        packKey: "cra",
        reviewId,
        mappingId,
        action: "leave_gap",
      }),
    );
    expect(commit).toHaveBeenCalledWith(
      "org-a",
      expect.objectContaining({ actorId: "actor-a", packKey: "cra", reviewId }),
    );
  });

  it.each([
    [new UpgradeForbiddenError(), ForbiddenException],
    [new UpgradeInvalidRequestError(), BadRequestException],
    [new UpgradeNotFoundError(), NotFoundException],
    [new UpgradeBlockedError(), ConflictException],
  ])(
    "translates safe upgrade errors without leaking provider details",
    async (error, expected) => {
      crosswalks.mockRejectedValue(error);
      await expect(
        controller.crosswalks(
          { packKey: "cra", versionKey: "2024" },
          { limit: 10 },
          user,
        ),
      ).rejects.toBeInstanceOf(expected);
    },
  );
});
