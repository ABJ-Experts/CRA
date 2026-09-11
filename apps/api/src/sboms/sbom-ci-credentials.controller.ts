import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import {
  createSbomCiCredentialInputSchema,
  createSbomCiCredentialResponseSchema,
  revokeSbomCiCredentialInputSchema,
  sbomCiCredentialListResponseSchema,
  sbomCiCredentialParamsSchema,
  sbomCiCredentialResponseSchema,
  type CreateSbomCiCredentialInput,
  type RevokeSbomCiCredentialInput,
  type SbomCiCredentialParams,
} from "@repo/contracts/sboms";

import { CurrentUser, RequireRole, type RequestUser } from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodBody, zodParams } from "../common/pipes/zod-validation.pipe";
import { SbomService } from "./sbom.service";

@Controller("organizations/current/sbom-ci-credentials")
@RequireRole("owner")
export class SbomCiCredentialsController {
  constructor(private readonly sboms: SbomService) {}

  @Get()
  @ZodResponse(sbomCiCredentialListResponseSchema)
  list(@CurrentUser() user: RequestUser) {
    return this.sboms.listCredentials(organizationId(user));
  }

  @Post()
  @ZodResponse(createSbomCiCredentialResponseSchema)
  create(
    @Body(zodBody(createSbomCiCredentialInputSchema))
    input: CreateSbomCiCredentialInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.createCredential(organizationId(user), {
      actorId: user.id,
      label: input.label,
      idempotencyKey: input.idempotencyKey,
    });
  }

  @Post(":credentialId/revoke")
  @ZodResponse(sbomCiCredentialResponseSchema)
  revoke(
    @Param(zodParams(sbomCiCredentialParamsSchema))
    params: SbomCiCredentialParams,
    @Body(zodBody(revokeSbomCiCredentialInputSchema))
    input: RevokeSbomCiCredentialInput,
    @CurrentUser() user: RequestUser,
  ) {
    return this.sboms.revokeCredential(organizationId(user), {
      credentialId: params.credentialId,
      actorId: user.id,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

function organizationId(user: RequestUser): string {
  if (user.organizationId) return user.organizationId;
  throw new Error("organization is required by the global session guard");
}
