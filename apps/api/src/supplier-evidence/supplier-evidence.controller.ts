import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  closeSupplierEvidenceRequestInputSchema,
  completeSupplierEvidencePortalUploadInputSchema,
  createSupplierEvidenceRequestInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
  issueSupplierEvidenceRequestInputSchema,
  previewSupplierEvidenceRequestInputSchema,
  reissueSupplierEvidenceRequestInputSchema,
  revokeSupplierEvidenceRequestInputSchema,
  reviseSupplierEvidenceRequestInputSchema,
  supplierEvidenceIssuedResponseSchema,
  supplierEvidencePortalRequestSchema,
  supplierEvidencePortalSessionInputSchema,
  supplierEvidencePortalSessionResponseSchema,
  supplierEvidencePortalSubmissionParamsSchema,
  supplierEvidencePortalUploadCompletionResponseSchema,
  supplierEvidencePortalUploadInitializationResponseSchema,
  supplierEvidencePreviewResponseSchema,
  supplierEvidenceRequestListQuerySchema,
  supplierEvidenceRequestParamsSchema,
  supplierEvidenceRequestResponseSchema,
  supplierEvidenceRequestsResponseSchema,
  type CloseSupplierEvidenceRequestInput,
  type CompleteSupplierEvidencePortalUploadInput,
  type CreateSupplierEvidenceRequestInput,
  type InitializeSupplierEvidencePortalUploadInput,
  type IssueSupplierEvidenceRequestInput,
  type PreviewSupplierEvidenceRequestInput,
  type ReissueSupplierEvidenceRequestInput,
  type RevokeSupplierEvidenceRequestInput,
  type ReviseSupplierEvidenceRequestInput,
  type SupplierEvidencePortalSessionInput,
  type SupplierEvidencePortalSubmissionParams,
  type SupplierEvidenceRequestListQuery,
  type SupplierEvidenceRequestParams,
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
import { MailService } from "../mail/mail.service";
import {
  SupplierEvidenceConflictError,
  SupplierEvidenceForbiddenError,
  SupplierEvidenceInvalidRequestError,
  SupplierEvidenceUseCases,
} from "./application/supplier-evidence-use-cases";

@Controller("supplier-evidence-requests")
export class SupplierEvidenceRequestsController {
  constructor(
    private readonly evidence: SupplierEvidenceUseCases,
    private readonly mail: MailService,
  ) {}

  @Get()
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(supplierEvidenceRequestsResponseSchema)
  async list(
    @Query(zodQuery(supplierEvidenceRequestListQuerySchema))
    query: SupplierEvidenceRequestListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return this.evidence.list(org(user), { actorId: user.id, ...query });
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Post()
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_products",
    "can_upload_evidence",
  )
  @ZodResponse(supplierEvidenceRequestResponseSchema)
  async create(
    @Body(zodBody(createSupplierEvidenceRequestInputSchema))
    input: CreateSupplierEvidenceRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        request: await this.evidence.create(org(user), {
          actorId: user.id,
          ...input,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Get(":requestId")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(supplierEvidenceRequestResponseSchema)
  async detail(
    @Param(zodParams(supplierEvidenceRequestParamsSchema))
    params: SupplierEvidenceRequestParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const request = await this.evidence.detail(org(user), {
        actorId: user.id,
        requestId: params.requestId,
      });
      if (request) return { request };
    } catch (error) {
      throw internalFailure(error);
    }
    throw notFound();
  }

  @Post("preview")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_products",
    "can_upload_evidence",
  )
  @ZodResponse(supplierEvidencePreviewResponseSchema)
  async preview(
    @Body(zodBody(previewSupplierEvidenceRequestInputSchema))
    input: PreviewSupplierEvidenceRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        preview: await this.evidence.preview(org(user), {
          actorId: user.id,
          ...input,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Post(":requestId/revise")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_products",
    "can_upload_evidence",
  )
  @ZodResponse(supplierEvidenceRequestResponseSchema)
  async revise(
    @Param(zodParams(supplierEvidenceRequestParamsSchema))
    params: SupplierEvidenceRequestParams,
    @Body(zodBody(reviseSupplierEvidenceRequestInputSchema))
    input: ReviseSupplierEvidenceRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        request: await this.evidence.revise(org(user), {
          actorId: user.id,
          requestId: params.requestId,
          ...input,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Post(":requestId/issue")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_products",
    "can_upload_evidence",
  )
  @ZodResponse(supplierEvidenceIssuedResponseSchema)
  async issue(
    @Param(zodParams(supplierEvidenceRequestParamsSchema))
    params: SupplierEvidenceRequestParams,
    @Body(zodBody(issueSupplierEvidenceRequestInputSchema))
    input: IssueSupplierEvidenceRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const issued = await this.evidence.issue(org(user), {
        actorId: user.id,
        requestId: params.requestId,
        ...input,
      });
      if (issued.outcome !== "replayed") {
        if (!issued.invitationToken)
          throw new Error("Missing invitation bearer");
        await this.mail.sendSupplierEvidenceInvitation(
          issued.recipientEmail,
          issued.invitationToken,
          input.idempotencyKey,
        );
      }
      return { request: issued.request, invitation: issued.invitation };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Post(":requestId/reissue")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_products",
    "can_upload_evidence",
  )
  @ZodResponse(supplierEvidenceIssuedResponseSchema)
  async reissue(
    @Param(zodParams(supplierEvidenceRequestParamsSchema))
    params: SupplierEvidenceRequestParams,
    @Body(zodBody(reissueSupplierEvidenceRequestInputSchema))
    input: ReissueSupplierEvidenceRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const issued = await this.evidence.reissue(org(user), {
        actorId: user.id,
        requestId: params.requestId,
        ...input,
      });
      if (issued.outcome !== "replayed") {
        if (!issued.invitationToken)
          throw new Error("Missing invitation bearer");
        await this.mail.sendSupplierEvidenceInvitation(
          issued.recipientEmail,
          issued.invitationToken,
          input.idempotencyKey,
        );
      }
      return { request: issued.request, invitation: issued.invitation };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Post(":requestId/revoke")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_products",
    "can_upload_evidence",
  )
  @ZodResponse(supplierEvidenceRequestResponseSchema)
  async revoke(
    @Param(zodParams(supplierEvidenceRequestParamsSchema))
    params: SupplierEvidenceRequestParams,
    @Body(zodBody(revokeSupplierEvidenceRequestInputSchema))
    input: RevokeSupplierEvidenceRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        request: await this.evidence.revoke(org(user), {
          actorId: user.id,
          requestId: params.requestId,
          ...input,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Post(":requestId/close")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_products",
    "can_upload_evidence",
  )
  @ZodResponse(supplierEvidenceRequestResponseSchema)
  async close(
    @Param(zodParams(supplierEvidenceRequestParamsSchema))
    params: SupplierEvidenceRequestParams,
    @Body(zodBody(closeSupplierEvidenceRequestInputSchema))
    input: CloseSupplierEvidenceRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        request: await this.evidence.close(org(user), {
          actorId: user.id,
          requestId: params.requestId,
          ...input,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }
}

/** No authenticated CRA identity is read at this boundary; the opaque external session is revalidated for every request. */
@Public()
@Controller("supplier-evidence-portal")
export class SupplierEvidencePortalController {
  constructor(private readonly evidence: SupplierEvidenceUseCases) {}

  @Post("sessions")
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @ZodResponse(supplierEvidencePortalSessionResponseSchema)
  async redeem(
    @Body(zodBody(supplierEvidencePortalSessionInputSchema))
    input: SupplierEvidencePortalSessionInput,
  ) {
    try {
      return { session: await this.evidence.redeem(input) };
    } catch {
      throw portalDenied();
    }
  }

  @Get("request")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ZodResponse(supplierEvidencePortalRequestSchema)
  async request(
    @Headers("x-supplier-evidence-session") sessionToken: string | undefined,
  ) {
    if (!sessionToken) throw portalDenied();
    try {
      return this.evidence.portalRequest(sessionToken);
    } catch {
      throw portalDenied();
    }
  }

  @Post("submissions")
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ZodResponse(supplierEvidencePortalUploadInitializationResponseSchema)
  async reserve(
    @Body(zodBody(initializeSupplierEvidencePortalUploadInputSchema))
    input: InitializeSupplierEvidencePortalUploadInput,
  ) {
    try {
      const result = await this.evidence.reserve(input);
      return {
        submission: result.submission,
        versionId: result.versionId,
        upload: result.upload,
      };
    } catch {
      throw portalDenied();
    }
  }

  @Post("submissions/:versionId/complete")
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @ZodResponse(supplierEvidencePortalUploadCompletionResponseSchema)
  async complete(
    @Param(zodParams(supplierEvidencePortalSubmissionParamsSchema))
    params: SupplierEvidencePortalSubmissionParams,
    @Body(zodBody(completeSupplierEvidencePortalUploadInputSchema))
    input: CompleteSupplierEvidencePortalUploadInput,
  ) {
    try {
      return {
        submission: await this.evidence.finalize({
          sessionToken: input.sessionToken,
          versionId: params.versionId,
          idempotencyKey: input.idempotencyKey,
        }),
      };
    } catch {
      throw portalDenied();
    }
  }
}

function org(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw notFound();
}
function notFound(): NotFoundException {
  return new NotFoundException({
    code: "not_found",
    message: "Supplier evidence request was not found.",
  });
}
function portalDenied(): NotFoundException {
  return new NotFoundException({
    code: "not_found",
    message: "This supplier portal link is unavailable.",
  });
}
function internalFailure(error: unknown): Error {
  if (error instanceof SupplierEvidenceForbiddenError)
    return new ForbiddenException({ code: "forbidden" });
  if (
    error instanceof SupplierEvidenceConflictError ||
    error instanceof SupplierEvidenceInvalidRequestError
  )
    return new ConflictException({
      code: "conflict",
      message: "The supplier evidence request changed. Refresh and retry.",
    });
  return new ServiceUnavailableException({
    code: "unavailable",
    message: "Supplier evidence is temporarily unavailable.",
  });
}
