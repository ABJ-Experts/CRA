import {
  BadRequestException,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ciProviderWebhookParamsSchema,
  type CiProviderWebhookParams,
} from "@repo/contracts/sboms";
import type { Request } from "express";

import { Public } from "../../auth/auth.types";
import { NonJsonResponse } from "../../common/http/zod-response.interceptor";
import { zodParams } from "../../common/pipes/zod-validation.pipe";
import { CiProviderWebhookUseCases } from "./ci-provider-webhook";

type RawWebhookRequest = Request & Readonly<{ rawBody?: Buffer }>;

@Controller("ci/provider-events")
export class CiProviderWebhookController {
  constructor(private readonly useCases: CiProviderWebhookUseCases) {}

  @Public()
  @Post(":provider/:organizationId/:bindingId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @NonJsonResponse("empty")
  async receive(
    @Param(zodParams(ciProviderWebhookParamsSchema))
    params: CiProviderWebhookParams,
    @Req() request: RawWebhookRequest,
  ): Promise<void> {
    const result = await this.useCases.receive({
      ...params,
      rawBody: request.rawBody ?? Buffer.alloc(0),
      headers: request.headers,
    });
    switch (result.outcome) {
      case "recorded":
      case "replayed":
        return;
      case "unauthorized":
        throw new UnauthorizedException("Webhook could not be authenticated.");
      case "not_found":
        throw new NotFoundException("Webhook binding is unavailable.");
      case "invalid_request":
      case "untrusted":
        throw new BadRequestException("Webhook event is not trusted.");
      case "conflict":
        throw new ConflictException(
          "Webhook delivery conflicts with an earlier event.",
        );
      case "unavailable":
        throw new ServiceUnavailableException(
          "Webhook verification is temporarily unavailable.",
        );
    }
  }
}
