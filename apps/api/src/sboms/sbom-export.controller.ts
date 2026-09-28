import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  sbomDocumentParamsSchema,
  sbomExportQuerySchema,
  sbomExportResponseSchema,
  type SbomDocumentParams,
  type SbomExportQuery,
} from "@repo/contracts/sboms";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodParams, zodQuery } from "../common/pipes/zod-validation.pipe";
import { SbomExportUseCases } from "./application/sbom-export-use-cases";
@Controller("sbom-documents")
export class SbomExportController {
  constructor(private readonly exports: SbomExportUseCases) {}
  @Get(":documentId/export")
  @RequirePermissions("can_view_sboms")
  @ZodResponse(sbomExportResponseSchema)
  async export(
    @Param(zodParams(sbomDocumentParamsSchema)) params: SbomDocumentParams,
    @Query(zodQuery(sbomExportQuerySchema)) query: SbomExportQuery,
    @CurrentUser() user: RequestUser,
  ) {
    if (!user.organizationId) throw new NotFoundException();
    const result = await this.exports.export({
      organizationId: user.organizationId,
      actorId: user.id,
      documentId: params.documentId,
      ...query,
    });
    if (result.ok) return result.value;
    if (result.error.code === "not_found")
      throw new NotFoundException({
        code: "not_found",
        message: "SBOM export is unavailable.",
      });
    if (result.error.code === "conflict")
      throw new ConflictException({
        code: "conflict",
        message: result.error.message,
      });
    throw new ServiceUnavailableException({
      code: "unavailable",
      message: "SBOM export could not be prepared. Retry the read.",
    });
  }
}
