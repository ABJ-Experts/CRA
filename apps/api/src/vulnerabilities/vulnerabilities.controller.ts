import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  replayVulnerabilitySyncInputSchema,
  replayVulnerabilitySyncParamsSchema,
  triggerVulnerabilitySyncInputSchema,
  vulnerabilityFeedHealthResponseSchema,
  vulnerabilityFeedParamsSchema,
  vulnerabilitySyncRunListQuerySchema,
  vulnerabilitySyncRunListResponseSchema,
  vulnerabilitySyncRunResponseSchema,
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

/** Global reference-data operations; owner satisfies the admin minimum role. */
@Controller("vulnerability-feeds")
@RequireRole("admin")
export class VulnerabilityFeedsController {
  constructor(private readonly feeds: VulnerabilityFeedUseCases) {}

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
}
