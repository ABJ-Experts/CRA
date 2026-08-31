import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  replayVulnerabilitySyncInputSchema,
  replayVulnerabilitySyncParamsSchema,
  triggerVulnerabilitySyncInputSchema,
  vulnerabilityCsafReconciliationDetailResponseSchema,
  vulnerabilityCsafReconciliationParamsSchema,
  vulnerabilityFeedHealthResponseSchema,
  vulnerabilityFeedParamsSchema,
  vulnerabilitySyncRunListQuerySchema,
  vulnerabilitySyncRunListResponseSchema,
  vulnerabilitySyncRunResponseSchema,
  type VulnerabilityCsafReconciliationParams,
  type ReplayVulnerabilitySyncInput,
  type ReplayVulnerabilitySyncParams,
  type TriggerVulnerabilitySyncInput,
  type VulnerabilityFeedParams,
  type VulnerabilitySyncRunListQuery,
} from "@repo/contracts/vulnerabilities";

import { CurrentUser, RequireRole, type RequestUser } from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import {
  zodBody,
  zodParams,
  zodQuery,
} from "../common/pipes/zod-validation.pipe";
import {
  VulnerabilityFeedUnavailableError,
  VulnerabilityFeedUseCases,
} from "./application/vulnerability-feed-use-cases";
import {
  OfflineBundleImportUnavailableError,
  OfflineBundleImportUseCases,
} from "./application/offline-bundle-import-use-cases";

/** Global reference-data operations; owner satisfies the admin minimum role. */
@Controller("vulnerability-feeds")
@RequireRole("admin")
export class VulnerabilityFeedsController {
  constructor(
    private readonly feeds: VulnerabilityFeedUseCases,
    private readonly offlineBundles: OfflineBundleImportUseCases,
  ) {}

  @Get("health")
  @ZodResponse(vulnerabilityFeedHealthResponseSchema)
  async health() {
    try {
      return {
        observedAt: new Date().toISOString(),
        feeds: await this.feeds.health(),
      };
    } catch (error) {
      throw this.httpFailure(error);
    }
  }

  @Get("sync-runs")
  @ZodResponse(vulnerabilitySyncRunListResponseSchema)
  async listRuns(
    @Query(zodQuery(vulnerabilitySyncRunListQuerySchema))
    query: VulnerabilitySyncRunListQuery,
  ) {
    // The repository is intentionally capped at the contract page size. SQL
    // ordering/filtering remains authoritative once the rowset RPC is used.
    let result;
    try {
      result = await this.feeds.runs({
        feedKey: query.feedKey,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
    } catch (error) {
      throw this.httpFailure(error);
    }
    return {
      rows: result.rows,
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
      pageCount: Math.max(1, Math.ceil(result.total / query.pageSize)),
    };
  }

  @Post(":feedKey/sync")
  @HttpCode(200)
  @ZodResponse(vulnerabilitySyncRunResponseSchema)
  async requestSync(
    @Param(zodParams(vulnerabilityFeedParamsSchema))
    params: VulnerabilityFeedParams,
    @Body(zodBody(triggerVulnerabilitySyncInputSchema))
    input: TriggerVulnerabilitySyncInput,
    @CurrentUser() user: RequestUser,
  ) {
    let run;
    try {
      run = await this.feeds.requestSync({
        feedKey: params.feedKey,
        actorId: user.id,
        correlationId: randomUUID(),
        force: input.force,
      });
    } catch (error) {
      throw this.httpFailure(error);
    }
    return { run };
  }

  @Post(":feedKey/sync-runs/:runId/replay")
  @HttpCode(200)
  @ZodResponse(vulnerabilitySyncRunResponseSchema)
  async replay(
    @Param(zodParams(replayVulnerabilitySyncParamsSchema))
    params: ReplayVulnerabilitySyncParams,
    @Body(zodBody(replayVulnerabilitySyncInputSchema))
    _input: ReplayVulnerabilitySyncInput,
    @CurrentUser() user: RequestUser,
  ) {
    let run;
    try {
      run = await this.feeds.replay({
        feedKey: params.feedKey,
        runId: params.runId,
        actorId: user.id,
        correlationId: randomUUID(),
      });
    } catch (error) {
      throw this.httpFailure(error);
    }
    return { run };
  }

  @Get("csaf-reconciliations/:canonicalId")
  @ZodResponse(vulnerabilityCsafReconciliationDetailResponseSchema)
  async csafReconciliation(
    @Param(zodParams(vulnerabilityCsafReconciliationParamsSchema))
    params: VulnerabilityCsafReconciliationParams,
  ) {
    try {
      const reconciliation = await this.offlineBundles.csafReconciliation(
        params.canonicalId,
      );
      if (reconciliation === null) {
        throw new NotFoundException({
          message: "CSAF reconciliation detail was not found.",
          code: "not_found",
        });
      }
      return { reconciliation };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw this.offlineBundleFailure(error);
    }
  }

  private httpFailure(error: unknown): ServiceUnavailableException {
    if (error instanceof VulnerabilityFeedUnavailableError) {
      return new ServiceUnavailableException({
        message: "Vulnerability feed operation could not be completed.",
        code: "unavailable",
      });
    }
    return new ServiceUnavailableException({
      message: "Vulnerability feed operation could not be completed.",
      code: "unavailable",
    });
  }

  private offlineBundleFailure(error: unknown): ServiceUnavailableException {
    if (error instanceof OfflineBundleImportUnavailableError) {
      return new ServiceUnavailableException({
        message: "Offline bundle import could not be completed.",
        code: "unavailable",
      });
    }
    return new ServiceUnavailableException({
      message: "Offline bundle import could not be completed.",
      code: "unavailable",
    });
  }
}
