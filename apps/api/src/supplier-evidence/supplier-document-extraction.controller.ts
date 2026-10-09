import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  createManualSupplierDocumentFieldInputSchema,
  decideSupplierDocumentFieldInputSchema,
  startSupplierDocumentExtractionInputSchema,
  supplierDocumentExtractionQuerySchema,
  supplierDocumentExtractionResponseSchema,
  supplierDocumentFieldParamsSchema,
  supplierDocumentFieldResponseSchema,
  supplierDocumentSubmissionParamsSchema,
  type CreateManualSupplierDocumentFieldInput,
  type DecideSupplierDocumentFieldInput,
  type StartSupplierDocumentExtractionInput,
  type SupplierDocumentExtractionQuery,
  type SupplierDocumentFieldParams,
  type SupplierDocumentSubmissionParams,
} from "@repo/contracts/supplier-evidence";

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
  SupplierEvidenceConflictError,
  SupplierEvidenceForbiddenError,
  SupplierEvidenceInvalidRequestError,
} from "./application/supplier-evidence-use-cases";
import { SupplierDocumentExtractionUseCases } from "./application/supplier-document-extraction.use-cases";

@Controller("supplier-evidence-requests/:requestId/submissions/:submissionId")
export class SupplierDocumentExtractionController {
  constructor(
    private readonly extraction: SupplierDocumentExtractionUseCases,
  ) {}

  @Get("extraction")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
    "can_review_evidence",
  )
  @ZodResponse(supplierDocumentExtractionResponseSchema)
  async read(
    @Param(zodParams(supplierDocumentSubmissionParamsSchema))
    params: SupplierDocumentSubmissionParams,
    @Query(zodQuery(supplierDocumentExtractionQuerySchema))
    query: SupplierDocumentExtractionQuery,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.extraction.read(organizationId(user), {
        ...params,
        ...query,
        actorId: user.id,
      });
    } catch (error) {
      throw extractionFailure(error);
    }
  }

  @Post("extraction-runs")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
    "can_review_evidence",
  )
  @ZodResponse(supplierDocumentExtractionResponseSchema)
  async start(
    @Param(zodParams(supplierDocumentSubmissionParamsSchema))
    params: SupplierDocumentSubmissionParams,
    @Body(zodBody(startSupplierDocumentExtractionInputSchema))
    input: StartSupplierDocumentExtractionInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.extraction.start(organizationId(user), {
        ...params,
        ...input,
        actorId: user.id,
      });
    } catch (error) {
      throw extractionFailure(error);
    }
  }

  @Post("fields/:fieldId/decision")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
    "can_review_evidence",
  )
  @ZodResponse(supplierDocumentFieldResponseSchema)
  async decide(
    @Param(zodParams(supplierDocumentFieldParamsSchema))
    params: SupplierDocumentFieldParams,
    @Body(zodBody(decideSupplierDocumentFieldInputSchema))
    input: DecideSupplierDocumentFieldInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.extraction.decide(organizationId(user), {
        ...params,
        ...input,
        actorId: user.id,
      });
    } catch (error) {
      throw extractionFailure(error);
    }
  }

  @Post("fields/manual")
  @RequirePermissions(
    "can_view_suppliers",
    "can_view_products",
    "can_view_evidence",
    "can_review_evidence",
  )
  @ZodResponse(supplierDocumentFieldResponseSchema)
  async manual(
    @Param(zodParams(supplierDocumentSubmissionParamsSchema))
    params: SupplierDocumentSubmissionParams,
    @Body(zodBody(createManualSupplierDocumentFieldInputSchema))
    input: CreateManualSupplierDocumentFieldInput,
    @CurrentUser() user: RequestUser,
  ) {
    try {
      return await this.extraction.manual(organizationId(user), {
        ...params,
        ...input,
        actorId: user.id,
      });
    } catch (error) {
      throw extractionFailure(error);
    }
  }
}

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new NotFoundException({ code: "not_found" });
}

function extractionFailure(error: unknown): Error {
  if (error instanceof HttpException) return error;
  if (error instanceof SupplierEvidenceForbiddenError)
    return new ForbiddenException({ code: "forbidden" });
  if (
    error instanceof SupplierEvidenceConflictError ||
    error instanceof SupplierEvidenceInvalidRequestError
  ) {
    return new ConflictException({
      code: "conflict",
      message: "The document or review changed. Refresh and retry.",
    });
  }
  return new ServiceUnavailableException({
    code: "unavailable",
    message:
      "Document extraction is temporarily unavailable. Manual review remains available.",
  });
}
