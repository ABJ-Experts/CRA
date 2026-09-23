import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  completeSupplierEvidenceSbomUploadInputSchema,
  initializeSupplierEvidenceSbomUploadInputSchema,
  supplierEvidenceEligibleSbomRequestsQuerySchema,
  supplierEvidenceEligibleSbomRequestsResponseSchema,
  supplierEvidenceSbomCompletionParamsSchema,
  supplierEvidenceSbomItemParamsSchema,
  supplierEvidenceSbomUploadCompletionResponseSchema,
  supplierEvidenceSbomUploadInitializationResponseSchema,
  type CompleteSupplierEvidenceSbomUploadInput,
  type InitializeSupplierEvidenceSbomUploadInput,
  type SupplierEvidenceEligibleSbomRequestsQuery,
  type SupplierEvidenceSbomCompletionParams,
  type SupplierEvidenceSbomItemParams,
} from "@repo/contracts/supplier-evidence";

import {
  CurrentUser,
  Public,
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
  SupplierEvidenceSbomNotFoundError,
  SupplierEvidenceSbomUseCases,
} from "./application/supplier-evidence-sbom.use-cases";
import {
  SupplierEvidenceForbiddenError,
  SupplierEvidenceUnavailableError,
} from "./application/supplier-evidence-use-cases";

@Controller("supplier-evidence-requests")
export class SupplierEvidenceSbomInternalController {
  constructor(private readonly sboms: SupplierEvidenceSbomUseCases) {}

  @Get("eligible-sbom-requests")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_products",
    "can_upload_evidence",
    "can_review_sboms",
  )
  @ZodResponse(supplierEvidenceEligibleSbomRequestsResponseSchema)
  async eligible(
    @Query(zodQuery(supplierEvidenceEligibleSbomRequestsQuerySchema))
    query: SupplierEvidenceEligibleSbomRequestsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    const organizationId = user.organizationId;
    if (!organizationId) throw new NotFoundException();
    try {
      return await this.sboms.eligible(organizationId, {
        actorId: user.id,
        ...query,
      });
    } catch (error) {
      throw boundaryFailure(error);
    }
  }
}

/** M9's opaque item grant is rechecked before each M3 upload operation. */
@Controller("supplier-evidence-portal/sbom-items")
export class SupplierEvidenceSbomPortalController {
  constructor(private readonly sboms: SupplierEvidenceSbomUseCases) {}

  @Post(":checklistItemId/submissions")
  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ZodResponse(supplierEvidenceSbomUploadInitializationResponseSchema)
  async initialize(
    @Param(zodParams(supplierEvidenceSbomItemParamsSchema))
    params: SupplierEvidenceSbomItemParams,
    @Body(zodBody(initializeSupplierEvidenceSbomUploadInputSchema))
    input: InitializeSupplierEvidenceSbomUploadInput,
  ) {
    try {
      const result = await this.sboms.initialize({
        ...input,
        checklistItemId: params.checklistItemId,
      });
      return {
        sourceId: result.reservation.id,
        submission: portalSubmission(result.submission),
        upload: result.upload,
      };
    } catch (error) {
      throw boundaryFailure(error);
    }
  }

  @Post(":checklistItemId/submissions/:sourceId/complete")
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ZodResponse(supplierEvidenceSbomUploadCompletionResponseSchema)
  async complete(
    @Param(zodParams(supplierEvidenceSbomCompletionParamsSchema))
    params: SupplierEvidenceSbomCompletionParams,
    @Body(zodBody(completeSupplierEvidenceSbomUploadInputSchema))
    input: CompleteSupplierEvidenceSbomUploadInput,
  ) {
    try {
      const result = await this.sboms.complete({ ...input, ...params });
      return { submission: portalSubmission(result.submission) };
    } catch (error) {
      throw boundaryFailure(error);
    }
  }
}

function portalSubmission(
  submission: Awaited<
    ReturnType<SupplierEvidenceSbomUseCases["complete"]>
  >["submission"],
) {
  return {
    id: submission.id,
    state: submission.state,
    fileName: submission.fileName,
    validationMessage: safeValidationMessage(submission.state),
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  };
}

function safeValidationMessage(state: string): string | null {
  if (state === "validation_failed")
    return "The SBOM could not be validated for the requested component. Correct the file and upload it again.";
  return null;
}

function boundaryFailure(error: unknown): Error {
  if (error instanceof SupplierEvidenceSbomNotFoundError)
    return new NotFoundException({
      code: "not_found",
      message: "This supplier SBOM item is unavailable.",
    });
  if (error instanceof SupplierEvidenceForbiddenError)
    return new ForbiddenException({
      code: "forbidden",
      message: "You cannot review this supplier SBOM request.",
    });
  if (error instanceof SupplierEvidenceUnavailableError)
    return new ServiceUnavailableException({
      code: "unavailable",
      message: "The supplier SBOM service is temporarily unavailable.",
    });
  if (error instanceof HttpException) return error;
  return new ServiceUnavailableException({
    code: "unavailable",
    message: "The supplier SBOM service is temporarily unavailable.",
  });
}
