import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  commitFrameworkUpgradeInputSchema,
  commitFrameworkUpgradeResponseSchema,
  createFrameworkUpgradeReviewInputSchema,
  createFrameworkUpgradeReviewResponseSchema,
  frameworkCrosswalkEvidenceReuseParamsSchema,
  frameworkCrosswalkEvidenceReuseQuerySchema,
  frameworkCrosswalkEvidenceReuseResponseSchema,
  frameworkCrosswalkParamsSchema,
  frameworkCrosswalkQuerySchema,
  frameworkCrosswalkResponseSchema,
  frameworkUpgradeDecisionParamsSchema,
  frameworkUpgradePreviewParamsSchema,
  frameworkUpgradePreviewQuerySchema,
  frameworkUpgradePreviewResponseSchema,
  frameworkUpgradeReviewParamsSchema,
  frameworkUpgradeReviewQuerySchema,
  frameworkUpgradeReviewResponseSchema,
  frameworkSelectionParamsSchema,
  upsertFrameworkUpgradeDecisionInputSchema,
  frameworkUpgradeDecisionResponseSchema,
} from "@repo/contracts/frameworks";
import type { z } from "zod";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import {
  UpgradeBlockedError,
  UpgradeConflictError,
  UpgradeForbiddenError,
  UpgradeInvalidRequestError,
  UpgradeNotFoundError,
  UpgradeUseCases,
} from "./application/upgrade-use-cases";

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new ForbiddenException({
    message: "Select an organization first.",
    code: "no_organization",
  });
}

function translate(error: unknown): never {
  if (error instanceof UpgradeConflictError)
    throw new ConflictException({
      message:
        "The framework or controls changed. Refresh the preview and review your choices.",
      code: "framework_upgrade_conflict",
    });
  if (error instanceof UpgradeBlockedError)
    throw new ConflictException({
      message:
        "This upgrade is blocked. Review its mappings and edition authorization.",
      code: "framework_upgrade_blocked",
    });
  if (error instanceof UpgradeForbiddenError)
    throw new ForbiddenException({
      message:
        "You cannot access this framework upgrade or its product evidence.",
      code: "forbidden",
    });
  if (error instanceof UpgradeInvalidRequestError)
    throw new BadRequestException({
      message: "The framework upgrade request is invalid.",
      code: "validation_failed",
    });
  if (error instanceof UpgradeNotFoundError)
    throw new NotFoundException({
      message: "Framework upgrade not found.",
      code: "framework_upgrade_not_found",
    });
  throw error;
}

@Controller("frameworks")
export class UpgradesController {
  constructor(private readonly upgrades: UpgradeUseCases) {}

  @Get(":packKey/versions/:versionKey/crosswalks")
  @RequirePermissions("can_view_frameworks")
  @ZodResponse(frameworkCrosswalkResponseSchema)
  async crosswalks(
    @Param(zodParams(frameworkCrosswalkParamsSchema))
    params: z.output<typeof frameworkCrosswalkParamsSchema>,
    @Query(zodQuery(frameworkCrosswalkQuerySchema))
    query: z.output<typeof frameworkCrosswalkQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.upgrades.crosswalks(organizationId(user), {
        actorId: user.id,
        ...params,
        ...query,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Get(":packKey/upgrades/:targetVersionKey/preview")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(frameworkUpgradePreviewResponseSchema)
  async preview(
    @Param(zodParams(frameworkUpgradePreviewParamsSchema))
    params: z.output<typeof frameworkUpgradePreviewParamsSchema>,
    @Query(zodQuery(frameworkUpgradePreviewQuerySchema))
    query: z.output<typeof frameworkUpgradePreviewQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.upgrades.preview(organizationId(user), {
        actorId: user.id,
        ...params,
        ...query,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Post(":packKey/upgrade-reviews")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(createFrameworkUpgradeReviewResponseSchema)
  async createReview(
    @Param(zodParams(frameworkSelectionParamsSchema))
    params: z.output<typeof frameworkSelectionParamsSchema>,
    @Body(zodBody(createFrameworkUpgradeReviewInputSchema))
    body: z.output<typeof createFrameworkUpgradeReviewInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.upgrades.createReview(organizationId(user), {
        actorId: user.id,
        ...params,
        ...body,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Get(":packKey/upgrade-reviews/:reviewId")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(frameworkUpgradeReviewResponseSchema)
  async review(
    @Param(zodParams(frameworkUpgradeReviewParamsSchema))
    params: z.output<typeof frameworkUpgradeReviewParamsSchema>,
    @Query(zodQuery(frameworkUpgradeReviewQuerySchema))
    query: z.output<typeof frameworkUpgradeReviewQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.upgrades.review(organizationId(user), {
        actorId: user.id,
        ...params,
        ...query,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Put(":packKey/upgrade-reviews/:reviewId/decisions/:mappingId")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(frameworkUpgradeDecisionResponseSchema)
  async decide(
    @Param(zodParams(frameworkUpgradeDecisionParamsSchema))
    params: z.output<typeof frameworkUpgradeDecisionParamsSchema>,
    @Body(zodBody(upsertFrameworkUpgradeDecisionInputSchema))
    body: z.output<typeof upsertFrameworkUpgradeDecisionInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.upgrades.decide(organizationId(user), {
        actorId: user.id,
        ...params,
        ...body,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Post(":packKey/upgrade-reviews/:reviewId/commit")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(commitFrameworkUpgradeResponseSchema)
  async commit(
    @Param(zodParams(frameworkUpgradeReviewParamsSchema))
    params: z.output<typeof frameworkUpgradeReviewParamsSchema>,
    @Body(zodBody(commitFrameworkUpgradeInputSchema))
    body: z.output<typeof commitFrameworkUpgradeInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.upgrades.commit(organizationId(user), {
        actorId: user.id,
        ...params,
        ...body,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Get("evidence/:evidenceVersionId/crosswalk-reuse")
  @RequirePermissions(
    "can_view_frameworks",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(frameworkCrosswalkEvidenceReuseResponseSchema)
  async evidenceReuse(
    @Param(zodParams(frameworkCrosswalkEvidenceReuseParamsSchema))
    params: z.output<typeof frameworkCrosswalkEvidenceReuseParamsSchema>,
    @Query(zodQuery(frameworkCrosswalkEvidenceReuseQuerySchema))
    query: z.output<typeof frameworkCrosswalkEvidenceReuseQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.upgrades.evidenceReuse(organizationId(user), {
        actorId: user.id,
        ...params,
        ...query,
      });
    } catch (error) {
      return translate(error);
    }
  }
}
