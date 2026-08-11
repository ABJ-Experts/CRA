import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { memoryStorage } from "multer";
import {
  BRANDING_MAX_LOGO_BYTES,
  brandingLogoUploadFieldsSchema,
  organizationBrandingDraftResponseSchema,
  organizationBrandingResponseSchema,
  publishOrganizationBrandingInputSchema,
  removeOrganizationBrandingInputSchema,
  updateOrganizationBrandingDraftInputSchema,
  type PublishOrganizationBrandingInput,
  type BrandingLogoUploadFields,
  type RemoveOrganizationBrandingInput,
  type UpdateOrganizationBrandingDraftInput,
} from "@repo/contracts/organizations";

import {
  CurrentUser,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../../auth/auth.types";
import {
  NonJsonResponse,
  ZodResponse,
} from "../../common/http/zod-response.interceptor";
import { zodBody } from "../../common/pipes/zod-validation.pipe";
import { BrandingService } from "./branding.service";

@Controller("organizations/current/branding")
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @RequirePermissions("can_view_organization")
  @Get()
  @ZodResponse(organizationBrandingResponseSchema)
  resolved(@CurrentUser() user: RequestUser) {
    return this.branding.resolved({
      organizationId: this.organizationId(user),
      actorId: user.id,
    });
  }

  @RequirePermissions("can_view_organization")
  @Get("preview")
  @ZodResponse(organizationBrandingResponseSchema)
  preview(@CurrentUser() user: RequestUser) {
    return this.branding.preview({
      organizationId: this.organizationId(user),
      actorId: user.id,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Post("logo")
  @UseInterceptors(
    FileInterceptor("logo", {
      storage: memoryStorage(),
      limits: { fileSize: BRANDING_MAX_LOGO_BYTES },
    }),
  )
  @ZodResponse(organizationBrandingDraftResponseSchema)
  uploadLogo(
    @Body(zodBody(brandingLogoUploadFieldsSchema))
    fields: BrandingLogoUploadFields,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: "A logo file is required.",
        code: "validation_failed",
      });
    }
    return this.branding.uploadLogo({
      organizationId: this.organizationId(user),
      actorId: user.id,
      altText: fields.altText,
      sourceBytes: Buffer.from(file.buffer),
      declaredMimeType: file.mimetype,
    });
  }

  @RequirePermissions("can_view_organization")
  @Get("logo/preview")
  @NonJsonResponse("stream")
  async renderLogo(
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const logo = await this.branding.renderLogo({
      organizationId: this.organizationId(user),
      actorId: user.id,
    });
    response.setHeader("Content-Type", logo.mimeType);
    // The URL intentionally has no storage key. Do not cache it across draft
    // replacements, because this endpoint resolves the current approved draft
    // asset server-side.
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("ETag", `"${logo.sha256}"`);
    response.send(logo.bytes);
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Patch()
  @ZodResponse(organizationBrandingDraftResponseSchema)
  saveDraft(
    @Body(zodBody(updateOrganizationBrandingDraftInputSchema))
    input: UpdateOrganizationBrandingDraftInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.branding.saveDraft({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Post("publish")
  @ZodResponse(organizationBrandingResponseSchema)
  publish(
    @Body(zodBody(publishOrganizationBrandingInputSchema))
    input: PublishOrganizationBrandingInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.branding.publish({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_organization")
  @Delete("logo")
  @ZodResponse(organizationBrandingResponseSchema)
  removeLogo(
    @Body(zodBody(removeOrganizationBrandingInputSchema))
    input: RemoveOrganizationBrandingInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.branding.removeLogo({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
  }

  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Organization branding request could not be completed.",
      code: "not_found",
    });
  }
}
