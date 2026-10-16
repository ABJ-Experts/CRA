import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  completeSupplierSbomUploadInputSchema,
  createSupplierSbomInvitationInputSchema,
  createSupplierSbomInvitationResponseSchema,
  createSupplierSbomRequestInputSchema,
  initializeSupplierSbomUploadInputSchema,
  reviewSupplierSbomSubmissionInputSchema,
  sbomSourceParamsSchema,
  sbomSupplierRequestParamsSchema,
  sbomSupplierRequestReleaseParamsSchema,
  sbomSupplierSubmissionParamsSchema,
  supplierSbomPortalSessionInputSchema,
  supplierSbomPortalSessionResponseSchema,
  supplierSbomRequestsQuerySchema,
  supplierSbomRequestsResponseSchema,
  supplierSbomRequestResponseSchema,
  supplierSbomSubmissionResponseSchema,
  supplierSbomUploadCompletionResponseSchema,
  supplierSbomUploadInitializationResponseSchema,
  type CompleteSupplierSbomUploadInput,
  type CreateSupplierSbomInvitationInput,
  type CreateSupplierSbomRequestInput,
  type InitializeSupplierSbomUploadInput,
  type ReviewSupplierSbomSubmissionInput,
  type SbomSupplierRequestParams,
  type SbomSupplierRequestReleaseParams,
  type SbomSupplierSubmissionParams,
  type SupplierSbomPortalSessionInput,
  type SupplierSbomRequestsQuery,
  type SbomSourceParams,
} from "@repo/contracts/sboms";

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
import { SupplierSbomService } from "./supplier-sbom.service";

@Controller("products/:productId/releases/:releaseId/supplier-sbom-requests")
export class ProductReleaseSupplierSbomController {
  constructor(private readonly suppliers: SupplierSbomService) {}

  @RequirePermissions("can_review_sboms")
  @Post()
  @ZodResponse(supplierSbomRequestResponseSchema)
  async createRequest(
    @Param(zodParams(sbomSupplierRequestReleaseParamsSchema))
    params: SbomSupplierRequestReleaseParams,
    @Body(zodBody(createSupplierSbomRequestInputSchema))
    input: CreateSupplierSbomRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    if (
      input.productId !== params.productId ||
      input.releaseId !== params.releaseId
    )
      throw new BadRequestException({
        message: "Supplier request path does not match its body.",
        code: "invalid_request",
      });
    return {
      request: await this.suppliers.createRequest({
        organizationId: organizationId(user),
        actorId: user.id,
        ...input,
      }),
    };
  }
}

@Controller("supplier-sbom-requests")
export class SupplierSbomRequestsController {
  constructor(private readonly suppliers: SupplierSbomService) {}

  @RequirePermissions("can_review_sboms")
  @Get()
  @ZodResponse(supplierSbomRequestsResponseSchema)
  async list(
    @Query(zodQuery(supplierSbomRequestsQuerySchema))
    query: SupplierSbomRequestsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.suppliers.listRequests({
      organizationId: organizationId(user),
      actorId: user.id,
      productId: query.productId,
      releaseId: query.releaseId,
      state: query.state,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @RequirePermissions("can_review_sboms")
  @Post(":requestId/invitations")
  @ZodResponse(createSupplierSbomInvitationResponseSchema)
  async invite(
    @Param(zodParams(sbomSupplierRequestParamsSchema))
    params: SbomSupplierRequestParams,
    @Body(zodBody(createSupplierSbomInvitationInputSchema))
    input: CreateSupplierSbomInvitationInput,
    @CurrentUser() user: RequestUser,
  ) {
    const invitation = await this.suppliers.createInvitation({
      organizationId: organizationId(user),
      actorId: user.id,
      requestId: params.requestId,
      ...input,
    });
    return invitation;
  }
}

@Controller("supplier-sbom-submissions")
export class SupplierSbomSubmissionsController {
  constructor(private readonly suppliers: SupplierSbomService) {}

  @RequirePermissions("can_review_sboms")
  @Post(":submissionId/review")
  @ZodResponse(supplierSbomSubmissionResponseSchema)
  async review(
    @Param(zodParams(sbomSupplierSubmissionParamsSchema))
    params: SbomSupplierSubmissionParams,
    @Body(zodBody(reviewSupplierSbomSubmissionInputSchema))
    input: ReviewSupplierSbomSubmissionInput,
    @CurrentUser() user: RequestUser,
  ) {
    const submission = await this.suppliers.reviewSubmission({
      organizationId: organizationId(user),
      actorId: user.id,
      submissionId: params.submissionId,
      decision: input.decision === "accept" ? "accepted" : "rejected",
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    return { submission };
  }
}

/** M9 boundary: no authenticated user or organization context crosses this controller. */
@Public()
@Controller("supplier-sbom-portal")
export class SupplierSbomPortalController {
  constructor(private readonly suppliers: SupplierSbomService) {}

  @Post("sessions")
  @ZodResponse(supplierSbomPortalSessionResponseSchema)
  async session(
    @Body(zodBody(supplierSbomPortalSessionInputSchema))
    input: SupplierSbomPortalSessionInput,
  ) {
    return {
      session: await this.suppliers.exchangeInvitation({
        invitationToken: input.invitationToken,
        sessionToken: input.sessionToken,
      }),
    };
  }

  @Post("submissions")
  @ZodResponse(supplierSbomUploadInitializationResponseSchema)
  async initialize(
    @Body(zodBody(initializeSupplierSbomUploadInputSchema))
    input: InitializeSupplierSbomUploadInput,
  ) {
    const initialized = await this.suppliers.initializeUpload({
      sessionToken: input.sessionToken,
      filename: input.fileName,
      byteSize: input.byteSize,
      mediaType: input.mediaType,
      sha256: input.sha256,
      idempotencyKey: input.idempotencyKey,
      declaredFormat: input.declaredFormat,
      declaredSpecVersion: input.declaredSpecVersion,
      correlationId: randomUUID(),
    });
    return {
      submission: portalSubmission(initialized.submission),
      upload: initialized.upload,
    };
  }

  @Post("submissions/:sourceId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(supplierSbomUploadCompletionResponseSchema)
  async complete(
    @Param(zodParams(sbomSourceParamsSchema)) params: SbomSourceParams,
    @Body(zodBody(completeSupplierSbomUploadInputSchema))
    input: CompleteSupplierSbomUploadInput,
  ) {
    const completed = await this.suppliers.completeUpload({
      sessionToken: input.sessionToken,
      sourceId: params.sourceId,
      idempotencyKey: input.idempotencyKey,
    });
    return { submission: portalSubmission(completed.submission) };
  }
}

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new NotFoundException({
    message: "Supplier SBOM request could not be completed.",
    code: "not_found",
  });
}

function portalSubmission(
  submission: Awaited<
    ReturnType<SupplierSbomService["initializeUpload"]>
  >["submission"],
) {
  return {
    id: submission.id,
    state: submission.state,
    fileName: submission.fileName,
    mediaType: submission.mediaType,
    byteSize: submission.byteSize,
    sha256: submission.sha256,
    validationMessage: submission.validationMessage,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  };
}
