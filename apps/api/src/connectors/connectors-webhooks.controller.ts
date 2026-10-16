import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import * as schemas from "@repo/contracts/connectors/schemas";
import type { z } from "zod";
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
import { WebhookUseCases } from "./application/webhook-use-cases";
import { webhookVerificationExample } from "./infrastructure/webhook-signature";
import { ConnectorsService } from "./connectors.service";

@Controller("connectors/webhooks")
export class ConnectorsWebhooksController {
  constructor(
    private readonly webhooks: WebhookUseCases,
    private readonly connectors: ConnectorsService,
  ) {}
  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Connector request could not be completed.",
      code: "not_found",
    });
  }
  @RequirePermissions("can_view_connectors")
  @Get("catalogue")
  @ZodResponse(schemas.webhookCatalogueResponseSchema)
  catalogue() {
    return {
      eventTypes: schemas.webhookEventTypeSchema.options.map((eventType) => ({
        eventType,
        displayName: eventType.replaceAll(".", " ").replaceAll("_", " "),
        resourceType: eventType.startsWith("reporting.")
          ? "reporting_obligation"
          : eventType.startsWith("vulnerability.")
            ? "finding"
            : eventType.startsWith("connector.")
              ? "sync_run"
              : eventType.includes("release")
                ? "release"
                : "product",
      })),
      verification: webhookVerificationExample,
    };
  }
  @RequirePermissions("can_view_connectors")
  @Get("verification/example")
  @ZodResponse(schemas.webhookVerificationExampleResponseSchema)
  verification() {
    return { verification: webhookVerificationExample };
  }
  @RequirePermissions("can_view_connectors")
  @Get()
  @ZodResponse(schemas.webhookEndpointsResponseSchema)
  async list(
    @Query(zodQuery(schemas.webhookPageQuerySchema))
    query: z.output<typeof schemas.webhookPageQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      endpoints: await this.connectors.run(
        this.webhooks.list(this.organizationId(user), user.id, query),
      ),
    };
  }
  @RequirePermissions("can_view_connectors")
  @Get(":endpointId")
  @ZodResponse(schemas.webhookEndpointResponseSchema)
  async get(
    @Param(zodParams(schemas.webhookEndpointParamsSchema))
    params: z.output<typeof schemas.webhookEndpointParamsSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      endpoint: await this.connectors.run(
        this.webhooks.get(
          this.organizationId(user),
          params.endpointId,
          user.id,
        ),
      ),
    };
  }
  @RequirePermissions("can_create_connectors")
  @Post()
  @HttpCode(HttpStatus.OK)
  @ZodResponse(schemas.webhookEndpointResponseSchema)
  async create(
    @Body(zodBody(schemas.createWebhookEndpointInputSchema))
    input: z.output<typeof schemas.createWebhookEndpointInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      endpoint: await this.connectors.run(
        this.webhooks.create(this.organizationId(user), user.id, input),
      ),
    };
  }
  @RequirePermissions("can_edit_connectors")
  @Patch(":endpointId")
  @ZodResponse(schemas.webhookEndpointResponseSchema)
  async update(
    @Param(zodParams(schemas.webhookEndpointParamsSchema))
    params: z.output<typeof schemas.webhookEndpointParamsSchema>,
    @Body(zodBody(schemas.updateWebhookEndpointInputSchema))
    input: z.output<typeof schemas.updateWebhookEndpointInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      endpoint: await this.connectors.run(
        this.webhooks.update(
          this.organizationId(user),
          params.endpointId,
          user.id,
          input,
        ),
      ),
    };
  }
  @RequirePermissions("can_edit_connectors")
  @Post(":endpointId/secret")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(schemas.webhookEndpointResponseSchema)
  async rotate(
    @Param(zodParams(schemas.webhookEndpointParamsSchema))
    params: z.output<typeof schemas.webhookEndpointParamsSchema>,
    @Body(zodBody(schemas.rotateWebhookSecretInputSchema))
    input: z.output<typeof schemas.rotateWebhookSecretInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      endpoint: await this.connectors.run(
        this.webhooks.rotateSecret(
          this.organizationId(user),
          params.endpointId,
          user.id,
          input,
        ),
      ),
    };
  }
  @RequirePermissions("can_edit_connectors")
  @Post(":endpointId/secret/revoke")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(schemas.webhookEndpointResponseSchema)
  async revoke(
    @Param(zodParams(schemas.webhookEndpointParamsSchema))
    params: z.output<typeof schemas.webhookEndpointParamsSchema>,
    @Body(zodBody(schemas.revokeWebhookSecretInputSchema))
    input: z.output<typeof schemas.revokeWebhookSecretInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      endpoint: await this.connectors.run(
        this.webhooks.control(
          this.organizationId(user),
          params.endpointId,
          user.id,
          "revoke_secret",
          input,
        ),
      ),
    };
  }
  @RequirePermissions("can_edit_connectors")
  @Post(":endpointId/enable")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(schemas.webhookEndpointResponseSchema)
  async enable(
    @Param(zodParams(schemas.webhookEndpointParamsSchema))
    params: z.output<typeof schemas.webhookEndpointParamsSchema>,
    @Body(zodBody(schemas.enableWebhookEndpointInputSchema))
    input: z.output<typeof schemas.enableWebhookEndpointInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      endpoint: await this.connectors.run(
        this.webhooks.control(
          this.organizationId(user),
          params.endpointId,
          user.id,
          "enable",
          input,
        ),
      ),
    };
  }
  @RequirePermissions("can_edit_connectors")
  @Post(":endpointId/disable")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(schemas.webhookEndpointResponseSchema)
  async disable(
    @Param(zodParams(schemas.webhookEndpointParamsSchema))
    params: z.output<typeof schemas.webhookEndpointParamsSchema>,
    @Body(zodBody(schemas.disableWebhookEndpointInputSchema))
    input: z.output<typeof schemas.disableWebhookEndpointInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      endpoint: await this.connectors.run(
        this.webhooks.control(
          this.organizationId(user),
          params.endpointId,
          user.id,
          "disable",
          input,
        ),
      ),
    };
  }
  @RequirePermissions("can_edit_connectors")
  @Post(":endpointId/test")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(schemas.webhookDeliveryResponseSchema)
  async test(
    @Param(zodParams(schemas.webhookEndpointParamsSchema))
    params: z.output<typeof schemas.webhookEndpointParamsSchema>,
    @Body(zodBody(schemas.testWebhookEndpointInputSchema))
    input: z.output<typeof schemas.testWebhookEndpointInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      delivery: await this.connectors.run(
        this.webhooks.control(
          this.organizationId(user),
          params.endpointId,
          user.id,
          "test",
          input,
        ),
      ),
    };
  }
  @RequirePermissions("can_view_connectors")
  @Get(":endpointId/deliveries")
  @ZodResponse(schemas.webhookDeliveriesResponseSchema)
  async deliveries(
    @Param(zodParams(schemas.webhookEndpointParamsSchema))
    params: z.output<typeof schemas.webhookEndpointParamsSchema>,
    @Query(zodQuery(schemas.webhookPageQuerySchema))
    query: z.output<typeof schemas.webhookPageQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      deliveries: await this.connectors.run(
        this.webhooks.deliveries(
          this.organizationId(user),
          params.endpointId,
          user.id,
          query,
        ),
      ),
    };
  }
  @RequirePermissions("can_view_connectors")
  @Get(":endpointId/deliveries/:deliveryId")
  @ZodResponse(schemas.webhookDeliveryDetailResponseSchema)
  async delivery(
    @Param(zodParams(schemas.webhookDeliveryParamsSchema))
    params: z.output<typeof schemas.webhookDeliveryParamsSchema>,
    @Query(zodQuery(schemas.webhookPageQuerySchema))
    query: z.output<typeof schemas.webhookPageQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      detail: await this.connectors.run(
        this.webhooks.delivery(
          this.organizationId(user),
          params.endpointId,
          params.deliveryId,
          user.id,
          query,
        ),
      ),
    };
  }
  @RequirePermissions("can_edit_connectors")
  @Post(":endpointId/deliveries/:deliveryId/replay/preview")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(schemas.webhookReplayPreviewResponseSchema)
  async replayPreview(
    @Param(zodParams(schemas.webhookDeliveryParamsSchema))
    params: z.output<typeof schemas.webhookDeliveryParamsSchema>,
    @Body(zodBody(schemas.webhookReplayPreviewInputSchema))
    input: z.output<typeof schemas.webhookReplayPreviewInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      preview: await this.connectors.run(
        this.webhooks.replayPreview(
          this.organizationId(user),
          params.endpointId,
          params.deliveryId,
          user.id,
          input,
        ),
      ),
    };
  }
  @RequirePermissions("can_edit_connectors")
  @Post(":endpointId/deliveries/:deliveryId/replay")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(schemas.webhookDeliveryResponseSchema)
  async replay(
    @Param(zodParams(schemas.webhookDeliveryParamsSchema))
    params: z.output<typeof schemas.webhookDeliveryParamsSchema>,
    @Body(zodBody(schemas.replayWebhookDeliveryInputSchema))
    input: z.output<typeof schemas.replayWebhookDeliveryInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      delivery: await this.connectors.run(
        this.webhooks.replay(
          this.organizationId(user),
          params.endpointId,
          params.deliveryId,
          user.id,
          input,
        ),
      ),
    };
  }
}
