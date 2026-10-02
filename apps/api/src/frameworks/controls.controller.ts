import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  archiveControlInputSchema,
  controlCommandResponseSchema,
  controlDetailResponseSchema,
  controlEvidenceLinkParamsSchema,
  controlListQuerySchema,
  controlListResponseSchema,
  controlMappingParamsSchema,
  controlOwnerCandidatesQuerySchema,
  controlOwnerCandidatesResponseSchema,
  controlParamsSchema,
  createControlInputSchema,
  createControlMappingInputSchema,
  endControlLinkInputSchema,
  endControlMappingInputSchema,
  linkControlEvidenceInputSchema,
  requirementCoverageParamsSchema,
  requirementCoverageQuerySchema,
  requirementCoverageResponseSchema,
  requirementApplicabilityParamsSchema,
  requirementApplicabilityInputSchema,
  requirementApplicabilityResponseSchema,
  updateControlInputSchema,
  updateControlMappingInputSchema,
} from "@repo/contracts/frameworks";
import type { z } from "zod";

import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { PermissionsService } from "../permissions/permissions.service";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import {
  ControlBlockedError,
  ControlConflictError,
  ControlForbiddenError,
  ControlInvalidRequestError,
  ControlNotFoundError,
  ControlUseCases,
  type ControlOperation,
} from "./application/control-use-cases";

type ControlParams = z.output<typeof controlParamsSchema>;
type LinkParams = z.output<typeof controlEvidenceLinkParamsSchema>;
type MappingParams = z.output<typeof controlMappingParamsSchema>;
type CoverageParams = z.output<typeof requirementCoverageParamsSchema>;
type ListQuery = z.output<typeof controlListQuerySchema>;
type OwnerQuery = z.output<typeof controlOwnerCandidatesQuerySchema>;
type CoverageQuery = z.output<typeof requirementCoverageQuerySchema>;
type ApplicabilityParams = z.output<
  typeof requirementApplicabilityParamsSchema
>;
type ApplicabilityInput = z.output<typeof requirementApplicabilityInputSchema>;
type CreateInput = z.output<typeof createControlInputSchema>;
type UpdateInput = z.output<typeof updateControlInputSchema>;
type ArchiveInput = z.output<typeof archiveControlInputSchema>;
type LinkInput = z.output<typeof linkControlEvidenceInputSchema>;
type MappingInput = z.output<typeof createControlMappingInputSchema>;

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new ForbiddenException({
    message: "Select an organization first.",
    code: "no_organization",
  });
}

function translate(error: unknown): never {
  if (error instanceof ControlConflictError)
    throw new ConflictException({
      message: "This control changed. Reload and try again.",
      code: "control_conflict",
    });
  if (error instanceof ControlForbiddenError)
    throw new ForbiddenException({
      message: "You cannot access this control or product.",
      code: "forbidden",
    });
  if (error instanceof ControlInvalidRequestError)
    throw new BadRequestException({
      message: "The control request is invalid.",
      code: "validation_failed",
    });
  if (error instanceof ControlBlockedError)
    throw new ConflictException({
      message: "This control can no longer be changed.",
      code: "control_change_blocked",
    });
  if (error instanceof ControlNotFoundError)
    throw new NotFoundException({
      message: "Control not found.",
      code: "control_not_found",
    });
  throw error;
}

@Controller("frameworks")
export class ControlsController {
  constructor(
    private readonly controls: ControlUseCases,
    private readonly permissions: PermissionsService,
  ) {}

  @Get("controls")
  @RequirePermissions("can_view_frameworks")
  @ZodResponse(controlListResponseSchema)
  async list(
    @Query(zodQuery(controlListQuerySchema)) query: ListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.controls.list(organizationId(user), {
        actorId: user.id,
        ...query,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Get("control-owner-candidates")
  @RequirePermissions("can_view_frameworks", "can_manage_frameworks")
  @ZodResponse(controlOwnerCandidatesResponseSchema)
  async ownerCandidates(
    @Query(zodQuery(controlOwnerCandidatesQuerySchema)) query: OwnerQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.controls.ownerCandidates(organizationId(user), {
        actorId: user.id,
        ...query,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Get("controls/:controlId")
  @RequirePermissions("can_view_frameworks")
  @ZodResponse(controlDetailResponseSchema)
  async detail(
    @Param(zodParams(controlParamsSchema)) params: ControlParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const orgId = organizationId(user);
      if (!user.role) throw new ControlForbiddenError();
      const [canViewEvidence, canViewProducts] = await Promise.all([
        this.permissions.can(orgId, user.id, user.role, ["can_view_evidence"]),
        this.permissions.can(orgId, user.id, user.role, ["can_view_products"]),
      ]);
      const detail = await this.controls.detail(orgId, {
        actorId: user.id,
        controlId: params.controlId,
        canViewEvidence,
        canViewProducts,
      });
      if (!detail) throw new ControlNotFoundError();
      return detail;
    } catch (error) {
      return translate(error);
    }
  }

  @Get(":packKey/versions/:versionKey/coverage")
  @RequirePermissions(
    "can_view_frameworks",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(requirementCoverageResponseSchema)
  async coverage(
    @Param(zodParams(requirementCoverageParamsSchema)) params: CoverageParams,
    @Query(zodQuery(requirementCoverageQuerySchema)) query: CoverageQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const coverage = await this.controls.coverage(organizationId(user), {
        actorId: user.id,
        ...params,
        ...query,
      });
      if (!coverage) throw new ControlNotFoundError();
      return coverage;
    } catch (error) {
      return translate(error);
    }
  }

  @Put(
    ":packKey/versions/:versionKey/requirements/:requirementKey/applicability",
  )
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
  )
  @ZodResponse(requirementApplicabilityResponseSchema)
  async setApplicability(
    @Param(zodParams(requirementApplicabilityParamsSchema))
    params: ApplicabilityParams,
    @Body(zodBody(requirementApplicabilityInputSchema))
    body: ApplicabilityInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.controls.setApplicability(organizationId(user), {
        actorId: user.id,
        ...params,
        ...body,
      });
    } catch (error) {
      return translate(error);
    }
  }

  private async command(
    user: RequestUser,
    operation: ControlOperation,
    payload: Record<string, unknown>,
    expectedRevision: number | null,
    idempotencyKey: string,
  ) {
    try {
      return await this.controls.command(organizationId(user), {
        actorId: user.id,
        operation,
        payload,
        expectedRevision,
        idempotencyKey,
      });
    } catch (error) {
      return translate(error);
    }
  }

  @Post("controls")
  @RequirePermissions("can_view_frameworks", "can_manage_frameworks")
  @ZodResponse(controlCommandResponseSchema)
  create(
    @Body(zodBody(createControlInputSchema)) body: CreateInput,
    @CurrentUser() user: RequestUser,
  ) {
    const { idempotencyKey, expectedRevision, status, ...rest } = body;
    return this.command(
      user,
      "create_control",
      { ...rest, implementationStatus: status },
      expectedRevision,
      idempotencyKey,
    );
  }

  @Put("controls/:controlId")
  @RequirePermissions("can_view_frameworks", "can_manage_frameworks")
  @ZodResponse(controlCommandResponseSchema)
  update(
    @Param(zodParams(controlParamsSchema)) params: ControlParams,
    @Body(zodBody(updateControlInputSchema)) body: UpdateInput,
    @CurrentUser() user: RequestUser,
  ) {
    const { idempotencyKey, expectedRevision, status, ...rest } = body;
    return this.command(
      user,
      "update_control",
      { controlId: params.controlId, ...rest, implementationStatus: status },
      expectedRevision,
      idempotencyKey,
    );
  }

  @Post("controls/:controlId/archive")
  @RequirePermissions("can_view_frameworks", "can_manage_frameworks")
  @ZodResponse(controlCommandResponseSchema)
  archive(
    @Param(zodParams(controlParamsSchema)) params: ControlParams,
    @Body(zodBody(archiveControlInputSchema)) body: ArchiveInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.command(
      user,
      "archive_control",
      { controlId: params.controlId },
      body.expectedRevision,
      body.idempotencyKey,
    );
  }

  @Post("controls/:controlId/evidence-links")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_evidence",
    "can_view_products",
  )
  @ZodResponse(controlCommandResponseSchema)
  linkEvidence(
    @Param(zodParams(controlParamsSchema)) params: ControlParams,
    @Body(zodBody(linkControlEvidenceInputSchema)) body: LinkInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.command(
      user,
      "link_evidence",
      {
        controlId: params.controlId,
        evidenceVersionId: body.evidenceVersionId,
        productId: body.productId,
      },
      body.expectedRevision,
      body.idempotencyKey,
    );
  }

  @Delete("controls/:controlId/evidence-links/:linkId")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_evidence",
    "can_view_products",
  )
  @ZodResponse(controlCommandResponseSchema)
  unlinkEvidence(
    @Param(zodParams(controlEvidenceLinkParamsSchema)) params: LinkParams,
    @Body(zodBody(endControlLinkInputSchema)) body: ArchiveInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.command(
      user,
      "unlink_evidence",
      params,
      body.expectedRevision,
      body.idempotencyKey,
    );
  }

  @Post("controls/:controlId/mappings")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
  )
  @ZodResponse(controlCommandResponseSchema)
  createMapping(
    @Param(zodParams(controlParamsSchema)) params: ControlParams,
    @Body(zodBody(createControlMappingInputSchema)) body: MappingInput,
    @CurrentUser() user: RequestUser,
  ) {
    const { idempotencyKey, expectedRevision, ...rest } = body;
    return this.command(
      user,
      "upsert_mapping",
      { controlId: params.controlId, ...rest },
      expectedRevision,
      idempotencyKey,
    );
  }

  @Put("controls/:controlId/mappings/:mappingId")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
  )
  @ZodResponse(controlCommandResponseSchema)
  updateMapping(
    @Param(zodParams(controlMappingParamsSchema)) params: MappingParams,
    @Body(zodBody(updateControlMappingInputSchema)) body: MappingInput,
    @CurrentUser() user: RequestUser,
  ) {
    const { idempotencyKey, expectedRevision, ...rest } = body;
    return this.command(
      user,
      "upsert_mapping",
      { ...params, ...rest },
      expectedRevision,
      idempotencyKey,
    );
  }

  @Delete("controls/:controlId/mappings/:mappingId")
  @RequirePermissions(
    "can_view_frameworks",
    "can_manage_frameworks",
    "can_view_products",
  )
  @ZodResponse(controlCommandResponseSchema)
  endMapping(
    @Param(zodParams(controlMappingParamsSchema)) params: MappingParams,
    @Body(zodBody(endControlMappingInputSchema)) body: ArchiveInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.command(
      user,
      "end_mapping",
      params,
      body.expectedRevision,
      body.idempotencyKey,
    );
  }
}
