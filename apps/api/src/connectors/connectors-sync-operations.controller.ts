import {
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
  connectorParamsSchema,
  syncRunParamsSchema,
  connectorMappingSchemaResponseSchema,
  connectorFieldMapResponseSchema,
  connectorMappingPreviewResponseSchema,
  previewConnectorFieldMappingInputSchema,
  saveConnectorFieldMappingInputSchema,
  syncHistoryQuerySchema,
  syncRunHistoryResponseSchema,
  syncRunDetailResponseSchema,
  syncDeadLettersResponseSchema,
  replaySyncRunPreviewInputSchema,
  replaySyncRunPreviewResponseSchema,
  replaySyncRunInputSchema,
  syncRunResponseSchema,
} from "@repo/contracts/connectors/schemas";
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
import { ConnectorSyncOperationsUseCases } from "./application/connector-sync-operations-use-cases";
import { ConnectorsService } from "./connectors.service";

@Controller("connectors")
export class ConnectorsSyncOperationsController {
  constructor(
    private readonly operations: ConnectorSyncOperationsUseCases,
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
  @Get(":connectorId/field-mapping/schema")
  @ZodResponse(connectorMappingSchemaResponseSchema)
  async mappingSchema(
    @Param(zodParams(connectorParamsSchema))
    params: z.output<typeof connectorParamsSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      schema: await this.connectors.run(
        this.operations.mappingSchema(
          this.organizationId(user),
          params.connectorId,
          user.id,
        ),
      ),
    };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/field-mapping")
  @ZodResponse(connectorFieldMapResponseSchema)
  async currentMapping(
    @Param(zodParams(connectorParamsSchema))
    params: z.output<typeof connectorParamsSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      mapping: await this.connectors.run(
        this.operations.currentMapping(
          this.organizationId(user),
          params.connectorId,
          user.id,
        ),
      ),
    };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/field-mapping/preview")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(connectorMappingPreviewResponseSchema)
  async previewMapping(
    @Param(zodParams(connectorParamsSchema))
    params: z.output<typeof connectorParamsSchema>,
    @Body(zodBody(previewConnectorFieldMappingInputSchema))
    input: z.output<typeof previewConnectorFieldMappingInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      preview: await this.connectors.run(
        this.operations.previewMapping(
          this.organizationId(user),
          params.connectorId,
          user.id,
          input,
        ),
      ),
    };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/field-mapping")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(connectorFieldMapResponseSchema)
  async saveMapping(
    @Param(zodParams(connectorParamsSchema))
    params: z.output<typeof connectorParamsSchema>,
    @Body(zodBody(saveConnectorFieldMappingInputSchema))
    input: z.output<typeof saveConnectorFieldMappingInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      mapping: await this.connectors.run(
        this.operations.saveMapping(
          this.organizationId(user),
          params.connectorId,
          user.id,
          input,
        ),
      ),
    };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/sync-history")
  @ZodResponse(syncRunHistoryResponseSchema)
  async history(
    @Param(zodParams(connectorParamsSchema))
    params: z.output<typeof connectorParamsSchema>,
    @Query(zodQuery(syncHistoryQuerySchema))
    query: z.output<typeof syncHistoryQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      runs: await this.connectors.run(
        this.operations.history(
          this.organizationId(user),
          params.connectorId,
          user.id,
          query,
        ),
      ),
    };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/sync-runs/:syncRunId/history")
  @ZodResponse(syncRunDetailResponseSchema)
  async detail(
    @Param(zodParams(syncRunParamsSchema))
    params: z.output<typeof syncRunParamsSchema>,
    @Query(zodQuery(syncHistoryQuerySchema))
    query: z.output<typeof syncHistoryQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return this.connectors.run(
      this.operations.detail(
        this.organizationId(user),
        params.connectorId,
        params.syncRunId,
        user.id,
        query,
      ),
    );
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/dead-letter-records")
  @ZodResponse(syncDeadLettersResponseSchema)
  async deadLetters(
    @Param(zodParams(connectorParamsSchema))
    params: z.output<typeof connectorParamsSchema>,
    @Query(zodQuery(syncHistoryQuerySchema))
    query: z.output<typeof syncHistoryQuerySchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      records: await this.connectors.run(
        this.operations.deadLetters(
          this.organizationId(user),
          params.connectorId,
          user.id,
          query,
        ),
      ),
    };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/sync-runs/:syncRunId/replay/preview")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(replaySyncRunPreviewResponseSchema)
  async replayPreview(
    @Param(zodParams(syncRunParamsSchema))
    params: z.output<typeof syncRunParamsSchema>,
    @Body(zodBody(replaySyncRunPreviewInputSchema))
    input: z.output<typeof replaySyncRunPreviewInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      preview: await this.connectors.run(
        this.operations.replayPreview(
          this.organizationId(user),
          params.connectorId,
          params.syncRunId,
          user.id,
          input,
        ),
      ),
    };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/sync-runs/:syncRunId/replay")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(syncRunResponseSchema)
  async replay(
    @Param(zodParams(syncRunParamsSchema))
    params: z.output<typeof syncRunParamsSchema>,
    @Body(zodBody(replaySyncRunInputSchema))
    input: z.output<typeof replaySyncRunInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    return {
      run: await this.connectors.run(
        this.operations.replay(
          this.organizationId(user),
          params.connectorId,
          params.syncRunId,
          user.id,
          input,
        ),
      ),
    };
  }
}
