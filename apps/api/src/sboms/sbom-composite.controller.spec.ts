import { PATH_METADATA } from "@nestjs/common/constants";
import {
  sbomCompositeGenerationResponseSchema,
  sbomCompositeReviewResponseSchema,
} from "@repo/contracts/sboms";

import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";
import { ZOD_RESPONSE_SCHEMA } from "../common/http/zod-response.interceptor";
import {
  ProductReleaseSbomCompositeController,
  SbomCompositeReviewsController,
} from "./sbom-composite.controller";

const user: RequestUser = {
  id: "00000000-0000-4000-8000-000000000001",
  authUserId: "00000000-0000-4000-8000-000000000002",
  email: "owner@cra.test",
  isActive: true,
  organizationId: "00000000-0000-4000-8000-000000000003",
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
};
const ids = {
  productId: "00000000-0000-4000-8000-000000000004",
  releaseId: "00000000-0000-4000-8000-000000000005",
  sourceId: "00000000-0000-4000-8000-000000000006",
  reviewId: "00000000-0000-4000-8000-000000000007",
  conflictId: "00000000-0000-4000-8000-000000000008",
};

function method(
  controller: object,
  name: string,
): (...args: never[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(controller),
    name,
  );
  const value: unknown = descriptor?.value;
  if (typeof value !== "function") throw new Error("missing method");
  return value as (...args: never[]) => unknown;
}

describe("SBOM composite controllers", () => {
  it("keeps creation release-scoped and requires the review permission", async () => {
    const service = {
      createCompositeReview: jest.fn().mockResolvedValue({ review: {} }),
    };
    const controller = new ProductReleaseSbomCompositeController(
      service as never,
    );
    const route = method(controller, "create");

    expect(Reflect.getMetadata(PATH_METADATA, route)).toBe(
      "sbom-composite-reviews",
    );
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, route)).toEqual([
      "can_review_sboms",
    ]);
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, route)).toBe(
      sbomCompositeReviewResponseSchema,
    );

    await controller.create(
      { productId: ids.productId, releaseId: ids.releaseId },
      {
        sourceIds: [ids.sourceId],
        idempotencyKey: "00000000-0000-4000-8000-000000000009",
      },
      user,
    );
    expect(service.createCompositeReview).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: user.organizationId,
        actorId: user.id,
        productId: ids.productId,
        releaseId: ids.releaseId,
      }),
    );
  });

  it("keeps generation asynchronous and protected by the same review permission", () => {
    const controller = new SbomCompositeReviewsController({} as never);
    const route = method(controller, "generate");
    expect(Reflect.getMetadata(PATH_METADATA, route)).toBe(
      ":reviewId/generate",
    );
    expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, route)).toEqual([
      "can_review_sboms",
    ]);
    expect(Reflect.getMetadata(ZOD_RESPONSE_SCHEMA, route)).toBe(
      sbomCompositeGenerationResponseSchema,
    );
  });
});
