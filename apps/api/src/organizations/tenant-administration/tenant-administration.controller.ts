import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  deactivateOrganizationInputSchema,
  destructiveReauthenticationInputSchema,
  destructiveReauthenticationResponseSchema,
  exportAttachmentDownloadResponseSchema,
  exportRequestInputSchema,
  exportRequestResponseSchema,
  latestOrganizationExportResponseSchema,
  organizationExportParamsSchema,
  organizationExportResponseSchema,
  organizationLifecycleResponseSchema,
  organizationSettingsCatalogResponseSchema,
  organizationSettingsResponseSchema,
  recoverOrganizationInputSchema,
  retentionPolicyResponseSchema,
  retentionPolicyUpdateInputSchema,
  scheduleOrganizationPurgeInputSchema,
  updateOrganizationSettingsInputSchema,
  type DeactivateOrganizationInput,
  type DestructiveReauthenticationInput,
  type ExportRequestInput,
  type OrganizationExportParams,
  type RecoverOrganizationInput,
  type RetentionPolicyUpdateInput,
  type ScheduleOrganizationPurgeInput,
  type UpdateOrganizationSettingsInput,
} from "@repo/contracts/organizations";

import {
  AllowTenantRecovery,
  CurrentUser,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../../auth/auth.types";
import { ZodResponse } from "../../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../../common/pipes/zod-validation.pipe";
import { TenantAdministrationService } from "./tenant-administration.service";

@Controller("organizations/current")
export class TenantAdministrationController {
  constructor(private readonly tenant: TenantAdministrationService) {}

  @RequirePermissions("can_view_organization")
  @Get("settings")
  @ZodResponse(organizationSettingsResponseSchema)
  settings(@CurrentUser() user: RequestUser) {
    return this.tenant.settings(this.organizationId(user));
  }

  @RequirePermissions("can_view_organization")
  @Get("settings/catalog")
  @ZodResponse(organizationSettingsCatalogResponseSchema)
  settingsCatalog(@CurrentUser() user: RequestUser) {
    return this.tenant.settingsCatalog(this.organizationId(user));
  }

  @RequirePermissions("can_edit_organization")
  @Patch("settings")
  @ZodResponse(organizationSettingsResponseSchema)
  updateSettings(
    @Body(zodBody(updateOrganizationSettingsInputSchema))
    input: UpdateOrganizationSettingsInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.updateSettings({
      organizationId: this.organizationId(user),
      actorId: user.id,
      sessionId: this.sessionId(user),
      input,
    });
  }

  @RequirePermissions("can_view_organization")
  @Get("retention")
  @ZodResponse(retentionPolicyResponseSchema)
  retention(@CurrentUser() user: RequestUser) {
    return this.tenant.retention(this.organizationId(user));
  }

  @RequirePermissions("can_edit_organization")
  @Patch("retention")
  @ZodResponse(retentionPolicyResponseSchema)
  updateRetention(
    @Body(zodBody(retentionPolicyUpdateInputSchema))
    input: RetentionPolicyUpdateInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.updateRetention({
      organizationId: this.organizationId(user),
      actorId: user.id,
      input,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_export_organization")
  @Post("exports")
  @ZodResponse(exportRequestResponseSchema)
  requestExport(
    @Body(zodBody(exportRequestInputSchema)) input: ExportRequestInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.requestExport({
      organizationId: this.organizationId(user),
      actorId: user.id,
      idempotencyKey: input.idempotencyKey,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_export_organization")
  @Get("exports/latest")
  @ZodResponse(latestOrganizationExportResponseSchema)
  latestExport(@CurrentUser() user: RequestUser) {
    return this.tenant.latestExport(this.organizationId(user));
  }

  @RequireRole("owner")
  @RequirePermissions("can_export_organization")
  @Get("exports/:exportId")
  @ZodResponse(organizationExportResponseSchema)
  exportStatus(
    @Param(zodParams(organizationExportParamsSchema))
    params: OrganizationExportParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.exportStatus({
      organizationId: this.organizationId(user),
      exportId: params.exportId,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_export_organization")
  @Get("exports/:exportId/download")
  @ZodResponse(exportAttachmentDownloadResponseSchema)
  downloadExport(
    @Param(zodParams(organizationExportParamsSchema))
    params: OrganizationExportParams,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.downloadExport({
      organizationId: this.organizationId(user),
      exportId: params.exportId,
      actorId: user.id,
    });
  }

  @AllowTenantRecovery(
    "Allows an owner to read lifecycle state for only the signed inactive tenant recovery flow.",
  )
  @RequirePermissions("can_view_organization")
  @Get("lifecycle")
  @ZodResponse(organizationLifecycleResponseSchema)
  lifecycle(@CurrentUser() user: RequestUser) {
    return this.tenant.lifecycle(this.organizationId(user));
  }

  @AllowTenantRecovery(
    "Allows an owner to establish a fresh grant needed to recover only the signed inactive tenant.",
  )
  @RequireRole("owner")
  @RequirePermissions("can_delete_organization")
  @Post("lifecycle/reauthentication")
  @ZodResponse(destructiveReauthenticationResponseSchema)
  reauthenticate(
    @Body(zodBody(destructiveReauthenticationInputSchema))
    input: DestructiveReauthenticationInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.reauthenticate({
      organizationId: this.organizationId(user),
      actorId: user.id,
      sessionId: this.sessionId(user),
      email: user.email,
      accessToken: user.accessToken,
      ...input,
    });
  }

  @RequireRole("owner")
  @RequirePermissions("can_delete_organization")
  @Post("lifecycle/deactivate")
  @ZodResponse(organizationLifecycleResponseSchema)
  deactivate(
    @Body(zodBody(deactivateOrganizationInputSchema))
    input: DeactivateOrganizationInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.deactivate({
      organizationId: this.organizationId(user),
      actorId: user.id,
      sessionId: this.sessionId(user),
      ...input,
    });
  }

  @AllowTenantRecovery(
    "Allows an owner to schedule purge for only the signed deactivated tenant after a one-use fresh grant.",
  )
  @RequireRole("owner")
  @RequirePermissions("can_delete_organization")
  @Post("lifecycle/purge")
  @ZodResponse(organizationLifecycleResponseSchema)
  schedulePurge(
    @Body(zodBody(scheduleOrganizationPurgeInputSchema))
    input: ScheduleOrganizationPurgeInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.schedulePurge({
      organizationId: this.organizationId(user),
      actorId: user.id,
      sessionId: this.sessionId(user),
      ...input,
    });
  }

  @AllowTenantRecovery(
    "Allows only an owner to recover the signed inactive tenant after a one-use fresh grant.",
  )
  @RequireRole("owner")
  @RequirePermissions("can_delete_organization")
  @Post("lifecycle/recover")
  @ZodResponse(organizationLifecycleResponseSchema)
  recover(
    @Body(zodBody(recoverOrganizationInputSchema))
    input: RecoverOrganizationInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tenant.recover({
      organizationId: this.organizationId(user),
      actorId: user.id,
      sessionId: this.sessionId(user),
      ...input,
    });
  }

  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Organization administration request could not be completed.",
      code: "not_found",
    });
  }

  private sessionId(user: RequestUser): string {
    if (user.sessionId) return user.sessionId;
    throw new NotFoundException({
      message: "Organization administration request could not be completed.",
      code: "not_found",
    });
  }
}
