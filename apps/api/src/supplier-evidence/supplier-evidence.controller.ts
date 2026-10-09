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
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Throttle } from "@nestjs/throttler";
import {
  closeSupplierEvidenceRequestInputSchema,
  completeSupplierEvidencePortalUploadInputSchema,
  createSupplierEvidenceRequestInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
  issueSupplierEvidenceRequestInputSchema,
  reRequestSupplierEvidenceRequestInputSchema,
  previewSupplierEvidenceRequestInputSchema,
  reissueSupplierEvidenceRequestInputSchema,
  reviewSupplierEvidenceSubmissionInputSchema,
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
  supplierEvidenceMetricsQuerySchema,
  supplierEvidenceMetricsResponseSchema,
  supplierEvidenceOverdueListQuerySchema,
  supplierEvidenceOverdueListResponseSchema,
  supplierEvidenceReminderDeliveryParamsSchema,
  supplierEvidenceReminderDeliveryResponseSchema,
  supplierEvidenceReminderSettingsInputSchema,
  supplierEvidenceReminderSettingsResponseSchema,
  supplierEvidenceRequestListQuerySchema,
  supplierEvidenceRequestParamsSchema,
  supplierEvidenceRequestResponseSchema,
  supplierEvidenceRequestsResponseSchema,
  supplierEvidenceReviewResponseSchema,
  supplierEvidenceSubmissionParamsSchema,
  type CloseSupplierEvidenceRequestInput,
  type CompleteSupplierEvidencePortalUploadInput,
  type CreateSupplierEvidenceRequestInput,
  type InitializeSupplierEvidencePortalUploadInput,
  type IssueSupplierEvidenceRequestInput,
  type PreviewSupplierEvidenceRequestInput,
  type ReRequestSupplierEvidenceRequestInput,
  type ReissueSupplierEvidenceRequestInput,
  type ReviewSupplierEvidenceSubmissionInput,
  type RevokeSupplierEvidenceRequestInput,
  type ReviseSupplierEvidenceRequestInput,
  type SupplierEvidencePortalSessionInput,
  type SupplierEvidencePortalSubmissionParams,
  type SupplierEvidenceInvitation,
  type SupplierEvidenceMetricsQuery,
  type SupplierEvidenceOverdueListQuery,
  type SupplierEvidenceReminderDeliveryParams,
  type SupplierEvidenceReminderSettingsInput,
  type SupplierEvidenceRequestDetail,
  type SupplierEvidenceRequestListQuery,
  type SupplierEvidenceRequestParams,
  type SupplierEvidenceSubmissionParams,
  type RetrySupplierEvidenceReminderDeliveryInput,
  retrySupplierEvidenceReminderDeliveryInputSchema,
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
      return await this.evidence.list(org(user), {
        actorId: user.id,
        ...query,
      });
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

  @Get("reminder-settings")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(supplierEvidenceReminderSettingsResponseSchema)
  async reminderSettings(@CurrentUser() user: RequestUser) {
    try {
      return {
        settings: await this.evidence.getReminderSettings(org(user), {
          actorId: user.id,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Patch("reminder-settings")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(supplierEvidenceReminderSettingsResponseSchema)
  async updateReminderSettings(
    @Body(zodBody(supplierEvidenceReminderSettingsInputSchema))
    input: SupplierEvidenceReminderSettingsInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        settings: await this.evidence.updateReminderSettings(org(user), {
          actorId: user.id,
          ...input,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Get("metrics")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(supplierEvidenceMetricsResponseSchema)
  async metrics(
    @Query(zodQuery(supplierEvidenceMetricsQuerySchema))
    query: SupplierEvidenceMetricsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        summary: await this.evidence.metrics(org(user), {
          actorId: user.id,
          ...query,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Get("overdue")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(supplierEvidenceOverdueListResponseSchema)
  async overdue(
    @Query(zodQuery(supplierEvidenceOverdueListQuerySchema))
    query: SupplierEvidenceOverdueListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.evidence.overdue(org(user), {
        actorId: user.id,
        ...query,
      });
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Post(":requestId/reminder-deliveries/:deliveryId/retry")
  @RequirePermissions(
    "can_manage_suppliers",
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
  )
  @ZodResponse(supplierEvidenceReminderDeliveryResponseSchema)
  async retryReminderDelivery(
    @Param(zodParams(supplierEvidenceReminderDeliveryParamsSchema))
    params: SupplierEvidenceReminderDeliveryParams,
    @Body(zodBody(retrySupplierEvidenceReminderDeliveryInputSchema))
    input: RetrySupplierEvidenceReminderDeliveryInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        delivery: await this.evidence.retryReminderDelivery(org(user), {
          actorId: user.id,
          ...params,
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
      const delivery = await this.deliverInvitation(
        user,
        params.requestId,
        issued,
        input.idempotencyKey,
      );
      return { request: delivery.request, invitation: issued.invitation };
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
      const delivery = await this.deliverInvitation(
        user,
        params.requestId,
        issued,
        input.idempotencyKey,
      );
      return { request: delivery.request, invitation: issued.invitation };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Post(":requestId/submissions/:submissionId/review")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
    "can_review_evidence",
  )
  @ZodResponse(supplierEvidenceReviewResponseSchema)
  async review(
    @Param(zodParams(supplierEvidenceSubmissionParamsSchema))
    params: SupplierEvidenceSubmissionParams,
    @Body(zodBody(reviewSupplierEvidenceSubmissionInputSchema))
    input: ReviewSupplierEvidenceSubmissionInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return {
        request: await this.evidence.review(org(user), {
          actorId: user.id,
          requestId: params.requestId,
          submissionId: params.submissionId,
          ...input,
        }),
      };
    } catch (error) {
      throw internalFailure(error);
    }
  }

  @Get(":requestId/review")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
    "can_review_evidence",
  )
  @ZodResponse(supplierEvidenceReviewResponseSchema)
  async reviewDetail(
    @Param(zodParams(supplierEvidenceRequestParamsSchema))
    params: SupplierEvidenceRequestParams,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const request = await this.evidence.reviewDetail(org(user), {
        actorId: user.id,
        requestId: params.requestId,
      });
      if (request) return { request };
    } catch (error) {
      throw internalFailure(error);
    }
    throw notFound();
  }

  @Post(":requestId/re-request")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
    "can_review_evidence",
  )
  @ZodResponse(supplierEvidenceIssuedResponseSchema)
  async reRequest(
    @Param(zodParams(supplierEvidenceRequestParamsSchema))
    params: SupplierEvidenceRequestParams,
    @Body(zodBody(reRequestSupplierEvidenceRequestInputSchema))
    input: ReRequestSupplierEvidenceRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      const requested = await this.evidence.reRequest(org(user), {
        actorId: user.id,
        requestId: params.requestId,
        ...input,
      });
      const delivery = await this.deliverInvitation(
        user,
        params.requestId,
        requested,
        input.idempotencyKey,
      );
      return { request: delivery.request, invitation: requested.invitation };
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

  private async deliverInvitation(
    user: RequestUser,
    requestId: string,
    issued: Readonly<{
      outcome: "issued" | "reissued" | "re_requested" | "replayed";
      request: SupplierEvidenceRequestDetail;
      invitation: SupplierEvidenceInvitation;
      recipientEmail: string;
      invitationToken?: string;
    }>,
    idempotencyKey: string,
  ): Promise<Readonly<{ request: SupplierEvidenceRequestDetail }>> {
    if (issued.outcome === "replayed") return { request: issued.request };
    if (!issued.invitationToken) throw new Error("Missing invitation bearer");
    try {
      await this.mail.sendSupplierEvidenceInvitation(
        issued.recipientEmail,
        issued.invitationToken,
        idempotencyKey,
      );
    } catch (error) {
      try {
        const request = await this.evidence.markInvitationDelivery(org(user), {
          actorId: user.id,
          requestId,
          invitationId: issued.invitation.id,
          status: "failed",
          failureMessage:
            "Delivery could not be completed. Issue a replacement invitation.",
          expectedRequestVersion: issued.request.version,
          idempotencyKey: deliveryIdempotencyKey(
            idempotencyKey,
            issued.invitation.id,
            "failed",
          ),
        });
        return { request };
      } catch {
        // The original mail failure is more actionable at this boundary; the
        // durable transition is retried through the replacement-invitation flow.
        throw error;
      }
    }
    const request = await this.evidence.markInvitationDelivery(org(user), {
      actorId: user.id,
      requestId,
      invitationId: issued.invitation.id,
      status: "delivered",
      expectedRequestVersion: issued.request.version,
      idempotencyKey: deliveryIdempotencyKey(
        idempotencyKey,
        issued.invitation.id,
        "delivered",
      ),
    });
    return { request };
  }
}

function deliveryIdempotencyKey(
  requestIdempotencyKey: string,
  invitationId: string,
  status: "delivered" | "failed",
): string {
  const value = createHash("sha256")
    .update(`${requestIdempotencyKey}:${invitationId}:${status}`)
    .digest("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
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
      return await this.evidence.portalRequest(sessionToken);
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
