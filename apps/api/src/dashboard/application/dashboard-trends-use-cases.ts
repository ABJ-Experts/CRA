import { z } from "zod";
import { hasPermission } from "@repo/contracts/permissions";
import {
  dashboardTrendFiltersSchema,
  dashboardTrendsDataSchema,
  dashboardTrendsResponseSchema,
  dashboardTrendSourcesDataSchema,
  dashboardTrendSourcesResponseSchema,
  dashboardTrendSourceOffsetMax,
} from "@repo/contracts/dashboard/schemas";
import type {
  DashboardTrendsQuery,
  DashboardTrendsExportQuery,
  DashboardTrendSourcesQuery,
} from "@repo/contracts/dashboard/types";
import type { RequestUser } from "../../auth/auth.types";
import { dashboardSourceAccess } from "../domain/dashboard-access.policy";
import { dashboardTrendsCsv } from "../domain/dashboard-trends-csv";
import {
  DashboardForbiddenError,
  DashboardUnavailableError,
  type DashboardPermissionsPort,
  type DashboardCursorScope,
} from "./dashboard-read.port";
import {
  DashboardDatasetConflictError,
  type DashboardDatasetTokens,
  type DashboardTrendsReadPort,
} from "./dashboard-trends.port";
const pinSchema = z
  .object({
    snapshot: z.string().min(1).max(12000),
    maxFindingSequence: z.string().regex(/^\d+$/),
    maxCoverageSequence: z.string().regex(/^\d+$/),
    maxSnapshotSequence: z.string().regex(/^\d+$/),
    epoch: z.uuid(),
    cutoffAt: z.iso.datetime(),
  })
  .strict();
const envelopeSchema = z
  .object({ result: z.unknown(), snapshot: pinSchema })
  .strict();
const tokenPositionSchema = z
  .object({
    filters: dashboardTrendFiltersSchema,
    pin: pinSchema,
    datasetRevision: z.string().min(1).max(256),
  })
  .strict();
export class DashboardTrendsUseCases {
  constructor(
    private readonly repository: DashboardTrendsReadPort,
    private readonly permissions: DashboardPermissionsPort,
    private readonly tokens: DashboardDatasetTokens,
  ) {}
  async trends(user: RequestUser, query: DashboardTrendsQuery) {
    const { scope, access } = await this.authorize(user);
    return this.readTrends(scope, access, query);
  }
  private async readTrends(
    scope: DashboardCursorScope,
    access: ReturnType<typeof dashboardSourceAccess>,
    query: DashboardTrendsQuery,
  ) {
    const { datasetToken, ...filters } = query;
    const position = datasetToken ? this.open(datasetToken, scope) : null;
    if (
      position &&
      this.tokens.fingerprint(filters) !==
        this.tokens.fingerprint(position.filters)
    )
      throw new DashboardDatasetConflictError();
    const raw = await this.repository.read(scope.organizationId, {
      actorId: scope.actorId,
      endpoint: "trends",
      filters: { ...filters, sourceAccess: access },
      ...(position ? { snapshot: position.pin } : {}),
    });
    try {
      const envelope = envelopeSchema.parse(raw);
      const result = dashboardTrendsDataSchema.parse(envelope.result);
      if (
        result.organizationId !== scope.organizationId ||
        this.tokens.fingerprint(result.filters) !==
          this.tokens.fingerprint(filters)
      )
        throw new Error();
      this.checkWithheld(result, access);
      if (
        result.generatedAt !== envelope.snapshot.cutoffAt ||
        Object.values(result.series).some((series) =>
          series.buckets.some(
            (bucket) =>
              Date.parse(bucket.end) > Date.parse(envelope.snapshot.cutoffAt),
          ),
        )
      )
        throw new Error();
      if (
        position &&
        (result.datasetRevision !== position.datasetRevision ||
          this.tokens.fingerprint(envelope.snapshot) !==
            this.tokens.fingerprint(position.pin))
      )
        throw new DashboardDatasetConflictError();
      const token =
        datasetToken ??
        this.tokens.seal(scope, {
          filters,
          pin: envelope.snapshot,
          datasetRevision: result.datasetRevision,
        });
      return dashboardTrendsResponseSchema.parse({
        ...result,
        datasetToken: token,
      });
    } catch (error) {
      if (error instanceof DashboardDatasetConflictError) throw error;
      throw new DashboardUnavailableError();
    }
  }
  async sources(user: RequestUser, query: DashboardTrendSourcesQuery) {
    const { scope, access } = await this.authorize(user);
    const position = this.open(query.datasetToken, scope);
    const grants = {
      activity: access.findings,
      triage: access.findings,
      remediation: access.findings,
      sbomCoverage: access.sbomCoverage,
      readiness: access.readiness,
    };
    if (!grants[query.metric]) throw new DashboardForbiddenError();
    if (
      ["triage", "remediation", "readiness"].includes(query.metric) &&
      !position.filters.productId
    )
      throw new DashboardForbiddenError();
    const cursorScope = {
      ...scope,
      endpoint: "trendSources",
      filters: {
        datasetToken: query.datasetToken,
        metric: query.metric,
        datasetRevision: position.datasetRevision,
        limit: query.limit,
      },
    };
    let offset = 0;
    if (query.cursor) {
      const c = z
        .object({
          offset: z
            .number()
            .int()
            .nonnegative()
            .max(dashboardTrendSourceOffsetMax),
        })
        .strict()
        .safeParse(this.tokens.open(query.cursor, cursorScope));
      if (!c.success) throw new DashboardDatasetConflictError();
      offset = c.data.offset;
    }
    const raw = await this.repository.read(scope.organizationId, {
      actorId: scope.actorId,
      endpoint: "sources",
      filters: {
        ...position.filters,
        sourceAccess: access,
        metric: query.metric,
        datasetRevision: position.datasetRevision,
        offset,
        limit: query.limit,
      },
      snapshot: position.pin,
    });
    try {
      const envelope = envelopeSchema.parse(raw);
      const result = dashboardTrendSourcesDataSchema.parse(envelope.result);
      if (
        result.nextOffset !== null &&
        (result.nextOffset <= offset ||
          result.nextOffset !== offset + result.items.length)
      )
        throw new Error();
      if (
        result.items.length > query.limit ||
        (position.filters.productId &&
          result.items.some(
            (item) => item.productId !== position.filters.productId,
          ))
      )
        throw new Error();
      if (
        result.datasetRevision !== position.datasetRevision ||
        this.tokens.fingerprint(envelope.snapshot) !==
          this.tokens.fingerprint(position.pin)
      )
        throw new DashboardDatasetConflictError();
      return dashboardTrendSourcesResponseSchema.parse({
        items: result.items.map((item) => ({
          ...item,
          id: this.tokens.opaqueSourceId(
            {
              ...scope,
              endpoint: "trendSourceIdentity",
              filters: position.filters,
            },
            {
              pin: position.pin,
              datasetRevision: position.datasetRevision,
              metric: query.metric,
            },
            item.id,
          ),
        })),
        datasetRevision: result.datasetRevision,
        ...(result.nextOffset !== null &&
        result.nextOffset > dashboardTrendSourceOffsetMax
          ? { continuationUnavailable: "source_page_limit" as const }
          : {}),
        nextCursor:
          result.nextOffset === null ||
          result.nextOffset > dashboardTrendSourceOffsetMax
            ? null
            : this.tokens.seal(cursorScope, { offset: result.nextOffset }),
      });
    } catch (error) {
      if (error instanceof DashboardDatasetConflictError) throw error;
      throw new DashboardUnavailableError();
    }
  }
  async export(user: RequestUser, query: DashboardTrendsExportQuery) {
    const { scope, access } = await this.authorize(user);
    const position = this.open(query.datasetToken, scope);
    const data = await this.readTrends(scope, access, {
      ...position.filters,
      datasetToken: query.datasetToken,
    });
    return dashboardTrendsCsv(data);
  }
  private open(token: string, scope: DashboardCursorScope) {
    const p = tokenPositionSchema.safeParse(this.tokens.open(token, scope));
    if (!p.success) throw new DashboardDatasetConflictError();
    return p.data;
  }
  private async authorize(user: RequestUser) {
    if (!user.isActive || !user.organizationId || !user.role || !user.sessionId)
      throw new DashboardForbiddenError();
    let context;
    try {
      context = await this.permissions.snapshot(
        user.organizationId,
        user.id,
        user.role,
      );
    } catch (error) {
      if (error instanceof DashboardForbiddenError) throw error;
      throw new DashboardUnavailableError();
    }
    if (!Number.isSafeInteger(context.version) || context.version <= 0)
      throw new DashboardUnavailableError();
    if (!hasPermission(context.permissions, "can_view_dashboards"))
      throw new DashboardForbiddenError();
    return {
      scope: {
        organizationId: user.organizationId,
        actorId: user.id,
        sessionId: user.sessionId,
        permissionFingerprint: this.tokens.fingerprint(context),
        endpoint: "trends",
        filters: {},
      },
      access: dashboardSourceAccess(context.permissions),
    };
  }
  private checkWithheld(
    data: z.output<typeof dashboardTrendsDataSchema>,
    access: ReturnType<typeof dashboardSourceAccess>,
  ) {
    const required = {
      activity: access.findings,
      triage: access.findings,
      remediation: access.findings,
      sbomCoverage: access.sbomCoverage,
      readiness: access.readiness,
    };
    for (const metric of Object.keys(required) as (keyof typeof required)[])
      if (!required[metric] && data.series[metric].state !== "restricted")
        throw new Error();
    if (
      !data.filters.productId &&
      (data.series.triage.state === "available" ||
        data.series.remediation.state === "available" ||
        data.series.readiness.state === "available")
    )
      throw new Error();
  }
}
