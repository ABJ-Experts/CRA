import { randomUUID } from "node:crypto";

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
import {
  archiveConnectorInputSchema,
  beginSyncRunInputSchema,
  cancelSyncRunInputSchema,
  conflictParamsSchema,
  connectorMetricsSnapshotResponseSchema,
  connectorOutcomeResponseSchema,
  connectorParamsSchema,
  connectorResponseSchema,
  connectorsResponseSchema,
  createConnectorInputSchema,
  diagnosticsExportInputSchema,
  diagnosticsExportResponseSchema,
  externalIdentityParamsSchema,
  fieldAuthorityPoliciesResponseSchema,
  fieldAuthorityImpactPreviewResponseSchema,
  fieldAuthorityPolicyParamsSchema,
  fieldAuthorityPolicyResponseSchema,
  linkExternalIdentityInputSchema,
  mergeExternalIdentitiesInputSchema,
  productExternalIdentitiesResponseSchema,
  productExternalIdentityResponseSchema,
  previewFieldAuthorityPolicyInputSchema,
  requestSyncRunCommitInputSchema,
  retrySyncRunInputSchema,
  resolveSyncConflictInputSchema,
  setConnectorSecretInputSchema,
  syncConflictResponseSchema,
  syncConflictsResponseSchema,
  syncRunListQuerySchema,
  syncRunParamsSchema,
  syncRunPlanItemsResponseSchema,
  syncRunResponseSchema,
  syncRunsResponseSchema,
  testConnectorInputSchema,
  unlinkExternalIdentityInputSchema,
  updateConnectorInputSchema,
  upsertFieldAuthorityPolicyInputSchema,
} from "@repo/contracts/connectors/schemas";
import type { SyncRunListQuery } from "@repo/contracts/connectors/types";
import { pageParamsSchema, type PageParams } from "@repo/contracts/pagination";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermissions,
  RequireRole,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import { ConnectorsService } from "./connectors.service";

@Controller("connectors")
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  private organizationId(user: RequestUser): string {
    if (user.organizationId) return user.organizationId;
    throw new NotFoundException({
      message: "Connector request could not be completed.",
      code: "not_found",
    });
  }

  @RequirePermissions("can_view_connectors")
  @Get()
  @ZodResponse(connectorsResponseSchema)
  async list(
    @Query(zodQuery(pageParamsSchema)) params: PageParams,
    @CurrentUser() user: RequestUser,
  ) {
    const connectors = await this.connectors.run(
      this.connectors.repository.listConnectors(
        this.organizationId(user),
        params,
      ),
    );
    return { connectors };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId")
  @ZodResponse(connectorResponseSchema)
  async get(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @CurrentUser() user: RequestUser,
  ) {
    const connector = await this.connectors.run(
      this.connectors.repository.getConnector(
        this.organizationId(user),
        params.connectorId,
      ),
    );
    return { connector };
  }

  @RequirePermissions("can_create_connectors")
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodResponse(connectorResponseSchema)
  async create(
    @Body(zodBody(createConnectorInputSchema))
    body: z.infer<typeof createConnectorInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const connector = await this.connectors.run(
      this.connectors.repository.createConnector({
        p_organization_id: this.organizationId(user),
        p_actor_user_id: user.id,
        p_idempotency_key: body.idempotencyKey,
        p_connector_type: body.connectorType,
        p_display_name: body.displayName,
        p_adapter_version: body.adapterVersion,
        p_mapping_version: body.mappingVersion,
        p_connection_config: body.connectionConfig ?? {},
        p_commit_policy: body.commitPolicy,
      }),
    );
    return { connector };
  }

  @RequirePermissions("can_edit_connectors")
  @Patch(":connectorId")
  @ZodResponse(connectorResponseSchema)
  async update(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Body(zodBody(updateConnectorInputSchema))
    body: z.infer<typeof updateConnectorInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const connector = await this.connectors.run(
      this.connectors.repository.updateConnector({
        p_organization_id: this.organizationId(user),
        p_connector_id: params.connectorId,
        p_actor_user_id: user.id,
        p_expected_version: body.expectedVersion,
        p_display_name: body.displayName,
        p_mapping_version: body.mappingVersion,
        p_connection_config: body.connectionConfig ?? {},
        p_commit_policy: body.commitPolicy,
      }),
    );
    return { connector };
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/secret")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(connectorResponseSchema)
  async setSecret(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Body(zodBody(setConnectorSecretInputSchema))
    body: z.infer<typeof setConnectorSecretInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const key = process.env.CONNECTOR_SECRET_ENCRYPTION_KEY;
    if (!key)
      throw new NotFoundException({
        message: "Connector secret storage is not configured.",
        code: "not_found",
      });
    const connector = await this.connectors.run(
      this.connectors.repository.setConnectorSecret(
        this.organizationId(user),
        params.connectorId,
        user.id,
        body.secretValue,
        key,
      ),
    );
    return { connector };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/test")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(connectorResponseSchema)
  async test(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Body(zodBody(testConnectorInputSchema)) _body: unknown,
    @CurrentUser() user: RequestUser,
  ) {
    const connector = await this.connectors.run(
      this.connectors.testConnection({
        organizationId: this.organizationId(user),
        connectorId: params.connectorId,
        actorId: user.id,
      }),
    );
    return { connector };
  }

  @RequirePermissions("can_delete_connectors")
  @Post(":connectorId/archive")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(connectorResponseSchema)
  async archive(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Body(zodBody(archiveConnectorInputSchema))
    body: z.infer<typeof archiveConnectorInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const connector = await this.connectors.run(
      this.connectors.repository.archiveConnector({
        p_organization_id: this.organizationId(user),
        p_connector_id: params.connectorId,
        p_actor_user_id: user.id,
        p_expected_version: body.expectedVersion,
        p_reason: body.reason,
      }),
    );
    return { connector };
  }

  // --- Field authority policy -----------------------------------------------

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/mapping")
  @ZodResponse(fieldAuthorityPoliciesResponseSchema)
  async mapping(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @CurrentUser() user: RequestUser,
  ) {
    const policies = await this.connectors.run(
      this.connectors.repository.listFieldAuthorityPolicies(
        this.organizationId(user),
        user.id,
        params.connectorId,
      ),
    );
    return { policies };
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/mapping/preview")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(fieldAuthorityImpactPreviewResponseSchema)
  async previewPolicy(
    @Param(zodParams(fieldAuthorityPolicyParamsSchema))
    params: { connectorId: string },
    @Body(zodBody(previewFieldAuthorityPolicyInputSchema))
    body: z.infer<typeof previewFieldAuthorityPolicyInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const preview = await this.connectors.run(
      this.connectors.repository.previewFieldAuthorityPolicy({
        p_organization_id: this.organizationId(user),
        p_connector_id: params.connectorId,
        p_actor_user_id: user.id,
        p_entity_type: body.entityType,
        p_field_name: body.fieldName,
        p_policy_value: body.policyValue,
        p_protected: body.protected,
        p_protected_reason: body.protectedReason ?? null,
      }),
    );
    return { preview };
  }

  @RequireRole("owner")
  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/mapping")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(fieldAuthorityPolicyResponseSchema)
  async upsertPolicy(
    @Param(zodParams(fieldAuthorityPolicyParamsSchema))
    params: { connectorId: string },
    @Body(zodBody(upsertFieldAuthorityPolicyInputSchema))
    body: z.infer<typeof upsertFieldAuthorityPolicyInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const policy = await this.connectors.run(
      this.connectors.repository.upsertFieldAuthorityPolicy({
        p_organization_id: this.organizationId(user),
        p_connector_id: params.connectorId,
        p_actor_user_id: user.id,
        p_entity_type: body.entityType,
        p_field_name: body.fieldName,
        p_policy_value: body.policyValue,
        p_protected: body.protected,
        p_protected_reason: body.protectedReason ?? null,
        p_preview_digest: body.previewDigest,
      }),
    );
    return { policy };
  }

  // --- Identity mapping --------------------------------------------------------

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/identities")
  @ZodResponse(productExternalIdentitiesResponseSchema)
  async identities(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Query(zodQuery(pageParamsSchema)) query: PageParams,
    @CurrentUser() user: RequestUser,
  ) {
    const identities = await this.connectors.run(
      this.connectors.repository.listExternalIdentities(
        this.organizationId(user),
        params.connectorId,
        query,
      ),
    );
    return { identities };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/identities/link")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(productExternalIdentityResponseSchema)
  async link(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Body(zodBody(linkExternalIdentityInputSchema))
    body: z.infer<typeof linkExternalIdentityInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const mapping = await this.connectors.run(
      this.connectors.repository.linkExternalIdentity({
        p_organization_id: this.organizationId(user),
        p_connector_id: params.connectorId,
        p_actor_user_id: user.id,
        p_entity_type: body.entityType,
        p_external_id: body.externalId,
        p_external_display_label: body.externalDisplayLabel ?? null,
        p_cra_product_id: body.craProductId,
        p_cra_release_id: body.craReleaseId ?? null,
        p_match_method: body.matchMethod,
      }),
    );
    return { mapping };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/identities/:mappingId/unlink")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(connectorOutcomeResponseSchema)
  async unlink(
    @Param(zodParams(externalIdentityParamsSchema))
    params: { connectorId: string; mappingId: string },
    @Body(zodBody(unlinkExternalIdentityInputSchema))
    body: z.infer<typeof unlinkExternalIdentityInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const outcome = await this.connectors.run(
      this.connectors.repository.unlinkExternalIdentity(
        this.organizationId(user),
        params.connectorId,
        params.mappingId,
        user.id,
        body.reason,
      ),
    );
    return { outcome };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/identities/merge")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(connectorOutcomeResponseSchema)
  async merge(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Body(zodBody(mergeExternalIdentitiesInputSchema))
    body: z.infer<typeof mergeExternalIdentitiesInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const outcome = await this.connectors.run(
      this.connectors.repository.mergeExternalIdentities(
        this.organizationId(user),
        params.connectorId,
        body.keepMappingId,
        body.mergeFromMappingId,
        user.id,
        body.reason,
      ),
    );
    return { outcome };
  }

  // --- Sync runs ---------------------------------------------------------------

  @RequirePermissions("can_create_connectors")
  @Post(":connectorId/sync-runs")
  @HttpCode(HttpStatus.ACCEPTED)
  @ZodResponse(syncRunResponseSchema)
  async beginRun(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Body(zodBody(beginSyncRunInputSchema))
    body: z.infer<typeof beginSyncRunInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const run = await this.connectors.run(
      this.connectors.repository.beginSyncRun({
        p_organization_id: this.organizationId(user),
        p_connector_id: params.connectorId,
        p_actor_user_id: user.id,
        p_reconciliation_kind: body.reconciliationKind,
        p_idempotency_key: body.idempotencyKey,
        p_correlation_id: randomUUID(),
      }),
    );
    return { run };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/sync-runs")
  @ZodResponse(syncRunsResponseSchema)
  async listRuns(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Query(zodQuery(syncRunListQuerySchema)) query: SyncRunListQuery,
    @CurrentUser() user: RequestUser,
  ) {
    const { status, ...pageParams } = query;
    const runs = await this.connectors.run(
      this.connectors.repository.listSyncRuns(
        this.organizationId(user),
        params.connectorId,
        pageParams,
        status,
      ),
    );
    return { runs };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/sync-runs/:syncRunId")
  @ZodResponse(syncRunResponseSchema)
  async getRun(
    @Param(zodParams(syncRunParamsSchema))
    params: { connectorId: string; syncRunId: string },
    @CurrentUser() user: RequestUser,
  ) {
    const run = await this.connectors.run(
      this.connectors.repository.getSyncRun(
        this.organizationId(user),
        params.connectorId,
        params.syncRunId,
      ),
    );
    return { run };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/sync-runs/:syncRunId/plan-items")
  @ZodResponse(syncRunPlanItemsResponseSchema)
  async planItems(
    @Param(zodParams(syncRunParamsSchema))
    params: { connectorId: string; syncRunId: string },
    @Query(zodQuery(pageParamsSchema)) query: PageParams,
    @CurrentUser() user: RequestUser,
  ) {
    const planItems = await this.connectors.run(
      this.connectors.repository.listSyncRunPlanItems(
        this.organizationId(user),
        params.connectorId,
        params.syncRunId,
        query,
      ),
    );
    return { planItems };
  }

  @RequirePermissions("can_approve_connectors")
  @Post(":connectorId/sync-runs/:syncRunId/request-commit")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(syncRunResponseSchema)
  async requestCommit(
    @Param(zodParams(syncRunParamsSchema))
    params: { connectorId: string; syncRunId: string },
    @Body(zodBody(requestSyncRunCommitInputSchema))
    body: z.infer<typeof requestSyncRunCommitInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const run = await this.connectors.run(
      this.connectors.repository.requestSyncRunCommit(
        this.organizationId(user),
        params.connectorId,
        params.syncRunId,
        user.id,
        body.expectedRowCount ?? null,
      ),
    );
    return { run };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/sync-runs/:syncRunId/cancel")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(syncRunResponseSchema)
  async cancel(
    @Param(zodParams(syncRunParamsSchema))
    params: { connectorId: string; syncRunId: string },
    @Body(zodBody(cancelSyncRunInputSchema))
    body: z.infer<typeof cancelSyncRunInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const run = await this.connectors.run(
      this.connectors.repository.cancelSyncRun(
        this.organizationId(user),
        params.connectorId,
        params.syncRunId,
        user.id,
        body.reason ?? null,
      ),
    );
    return { run };
  }

  @RequirePermissions("can_edit_connectors")
  @Post(":connectorId/sync-runs/:syncRunId/retry")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(syncRunResponseSchema)
  async retry(
    @Param(zodParams(syncRunParamsSchema))
    params: { connectorId: string; syncRunId: string },
    @Body(zodBody(retrySyncRunInputSchema)) _body: unknown,
    @CurrentUser() user: RequestUser,
  ) {
    const run = await this.connectors.run(
      this.connectors.repository.retrySyncRun(
        this.organizationId(user),
        params.connectorId,
        params.syncRunId,
        user.id,
      ),
    );
    return { run };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/sync-runs/:syncRunId/conflicts")
  @ZodResponse(syncConflictsResponseSchema)
  async runConflicts(
    @Param(zodParams(syncRunParamsSchema))
    params: { connectorId: string; syncRunId: string },
    @CurrentUser() user: RequestUser,
  ) {
    const conflicts = await this.connectors.run(
      this.connectors.repository.listConflictsForRun(
        this.organizationId(user),
        params.connectorId,
        params.syncRunId,
      ),
    );
    return { conflicts };
  }

  // --- Conflicts (flat) ----------------------------------------------------

  @RequirePermissions("can_view_connectors")
  @Get("conflicts/:conflictId")
  @ZodResponse(syncConflictResponseSchema)
  async getConflict(
    @Param(zodParams(conflictParamsSchema)) params: { conflictId: string },
    @CurrentUser() user: RequestUser,
  ) {
    const conflict = await this.connectors.run(
      this.connectors.repository.getConflict(
        this.organizationId(user),
        params.conflictId,
      ),
    );
    return { conflict };
  }

  @RequirePermissions("can_approve_connectors")
  @Post("conflicts/:conflictId/resolve")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(syncConflictResponseSchema)
  async resolveConflict(
    @Param(zodParams(conflictParamsSchema))
    params: { conflictId: string },
    @Body(zodBody(resolveSyncConflictInputSchema))
    body: z.infer<typeof resolveSyncConflictInputSchema>,
    @CurrentUser() user: RequestUser,
  ) {
    const conflict = await this.connectors.run(
      this.connectors.repository.resolveConflict({
        p_organization_id: this.organizationId(user),
        p_conflict_id: params.conflictId,
        p_actor_user_id: user.id,
        p_expected_version: body.expectedVersion,
        p_chosen_action: body.chosenAction,
        p_manual_value: body.manualValue ?? null,
        p_reason: body.reason,
        p_correlation_id: randomUUID(),
      }),
    );
    return { conflict };
  }

  // --- Dead letters + metrics ------------------------------------------------

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/dead-letters")
  @ZodResponse(syncRunsResponseSchema)
  async deadLetters(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Query(zodQuery(pageParamsSchema)) query: PageParams,
    @CurrentUser() user: RequestUser,
  ) {
    const runs = await this.connectors.run(
      this.connectors.repository.listDeadLetters(
        this.organizationId(user),
        params.connectorId,
        query,
      ),
    );
    return { runs };
  }

  @RequirePermissions("can_view_connectors")
  @Get(":connectorId/metrics-snapshot")
  @ZodResponse(connectorMetricsSnapshotResponseSchema)
  async metrics(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @CurrentUser() user: RequestUser,
  ) {
    await this.connectors.run(
      this.connectors.repository.getConnector(
        this.organizationId(user),
        params.connectorId,
      ),
    );
    const metrics = await this.connectors.run(
      this.connectors.repository.metricsSnapshot(this.organizationId(user)),
    );
    return { metrics };
  }

  @RequirePermissions("can_export_connectors")
  @Post(":connectorId/diagnostics/export")
  @HttpCode(HttpStatus.OK)
  @ZodResponse(diagnosticsExportResponseSchema)
  async exportDiagnostics(
    @Param(zodParams(connectorParamsSchema)) params: { connectorId: string },
    @Body(zodBody(diagnosticsExportInputSchema)) _body: unknown,
    @CurrentUser() user: RequestUser,
  ) {
    return this.connectors.run(
      this.connectors.repository.diagnosticsExport(
        this.organizationId(user),
        params.connectorId,
      ),
    );
  }
}
