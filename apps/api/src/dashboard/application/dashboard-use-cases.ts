import { z } from "zod";
import { hasPermission } from "@repo/contracts/permissions";
import {
  dashboardOverviewResponseSchema,
  dashboardProductPostureResponseSchema,
  dashboardObligationsResponseSchema,
  dashboardReadinessResponseSchema,
  dashboardIngestionResponseSchema,
} from "@repo/contracts/dashboard/schemas";
import type {
  DashboardOverviewQuery,
  DashboardProductPostureParams,
  DashboardProductPostureQuery,
  DashboardObligationsQuery,
  DashboardReadinessQuery,
  DashboardIngestionQuery,
} from "@repo/contracts/dashboard/types";
import type { RequestUser } from "../../auth/auth.types";
import { dashboardSourceAccess } from "../domain/dashboard-access.policy";
import {
  DashboardForbiddenError,
  DashboardInvalidCursorError,
  DashboardNotFoundError,
  DashboardUnavailableError,
  type DashboardEndpoint,
  type DashboardReadPort,
  type DashboardPermissionsPort,
  type DashboardTokens,
  type DashboardDiagnosticsPort,
} from "./dashboard-read.port";

const projectionSchema = z
  .object({
    result: z.record(z.string(), z.unknown()),
    nextPosition: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();
const restricted = {
  state: "restricted",
  observedAt: null,
  updatedAt: null,
} as const;

/** Read composition owns transport dependencies; source decisions remain in source projections. */
export class DashboardUseCases {
  constructor(
    private readonly repository: DashboardReadPort,
    private readonly permissions: DashboardPermissionsPort,
    private readonly tokens: DashboardTokens,
    private readonly diagnostics?: DashboardDiagnosticsPort,
  ) {}
  overview(user: RequestUser, query: DashboardOverviewQuery) {
    return this.read(user, "overview", query, dashboardOverviewResponseSchema);
  }
  posture(
    user: RequestUser,
    params: DashboardProductPostureParams,
    query: DashboardProductPostureQuery,
  ) {
    return this.read(
      user,
      "posture",
      { ...query, ...params },
      dashboardProductPostureResponseSchema,
    );
  }
  obligations(user: RequestUser, query: DashboardObligationsQuery) {
    return this.read(
      user,
      "obligations",
      query,
      dashboardObligationsResponseSchema,
    );
  }
  readiness(user: RequestUser, query: DashboardReadinessQuery) {
    return this.read(
      user,
      "readiness",
      query,
      dashboardReadinessResponseSchema,
    );
  }
  ingestion(user: RequestUser, query: DashboardIngestionQuery) {
    return this.read(
      user,
      "ingestion",
      query,
      dashboardIngestionResponseSchema,
    );
  }

  private async read<T extends z.ZodType>(
    user: RequestUser,
    endpoint: DashboardEndpoint,
    query: Readonly<Record<string, unknown>>,
    schema: T,
  ): Promise<z.output<T>> {
    if (!user.isActive || !user.organizationId || !user.role)
      throw new DashboardForbiddenError();
    const { permissions, version } = await this.permissionSnapshot(
      user.organizationId,
      user.id,
      user.role,
      endpoint,
    );
    if (!hasPermission(permissions, "can_view_dashboards"))
      throw new DashboardForbiddenError();
    const access = dashboardSourceAccess(permissions);
    if (endpoint === "posture" && !access.products)
      throw new DashboardNotFoundError();
    const { cursor, ...filters } = query;
    const scope = {
      organizationId: user.organizationId,
      actorId: user.id,
      sessionId: user.sessionId ?? "",
      permissionFingerprint: this.tokens.fingerprint({
        permissions,
        version,
      }),
      endpoint,
      filters,
    };
    if (cursor && !user.sessionId)
      throw new DashboardInvalidCursorError("Invalid dashboard cursor");
    const position =
      typeof cursor === "string" ? this.tokens.open(cursor, scope) : undefined;
    const raw = await this.repository.read(user.organizationId, {
      actorId: user.id,
      endpoint,
      filters: {
        ...filters,
        sourceAccess: access,
        ...(position ? { position } : {}),
      },
    });
    try {
      const projection = projectionSchema.parse(raw);
      if (projection.result.organizationId !== user.organizationId)
        throw new DashboardUnavailableError();
      const result = this.validSections(
        withhold(projection.result, access),
        endpoint,
      );
      const paged = this.withCursors(
        result,
        projection.nextPosition,
        scope,
        endpoint,
      );
      const parsed = schema.parse(paged);
      if (endpoint === "posture") {
        const product = (parsed as { product: { productId: string } }).product;
        if (product.productId !== filters.productId)
          throw new DashboardUnavailableError();
      }
      return parsed;
    } catch (error) {
      if (
        error instanceof z.ZodError ||
        error instanceof DashboardUnavailableError
      ) {
        this.diagnose(() =>
          this.diagnostics?.readUnavailable?.(endpoint, "response_validation"),
        );
        throw new DashboardUnavailableError(
          "Dashboard temporarily unavailable",
        );
      }
      throw error;
    }
  }
  private validSections(
    result: Readonly<Record<string, unknown>>,
    endpoint: DashboardEndpoint,
  ) {
    const sourceSchemas = {
      ...dashboardOverviewResponseSchema.shape,
      ...(endpoint === "obligations"
        ? { obligations: dashboardObligationsResponseSchema.shape.obligations }
        : {}),
      ...(endpoint === "readiness"
        ? { readiness: dashboardReadinessResponseSchema.shape.readiness }
        : {}),
      ...(endpoint === "ingestion"
        ? { ingestion: dashboardIngestionResponseSchema.shape.ingestion }
        : {}),
    };
    const sources = [
      "products",
      "findings",
      "obligations",
      "sbomCoverage",
      "readiness",
      "ingestion",
      "feedFreshness",
    ] as const;
    const expectedSources =
      endpoint === "overview"
        ? sources
        : endpoint === "posture"
          ? sources.filter((source) => source !== "products")
          : [endpoint];
    const complete = {
      ...Object.fromEntries(
        expectedSources.map((source) => [source, undefined]),
      ),
      ...result,
    };
    return Object.fromEntries(
      Object.entries(complete).map(([key, value]) => {
        const source = sources.find((source) => source === key);
        if (!source) return [key, value];
        const parsed = sourceSchemas[source].safeParse(value);
        const validCursor =
          parsed.success &&
          (!("data" in parsed.data) ||
            !["obligations", "readiness", "ingestion"].includes(source) ||
            (parsed.data.data as { nextCursor: string | null }).nextCursor ===
              null);
        if (parsed.success && validCursor) return [key, parsed.data];
        this.diagnose(() =>
          this.diagnostics?.sectionUnavailable(
            source,
            "provider_contract_invalid",
          ),
        );
        return [
          key,
          { state: "unavailable", observedAt: null, updatedAt: null },
        ];
      }),
    );
  }
  private withCursors(
    result: Readonly<Record<string, unknown>>,
    next: Readonly<Record<string, unknown>> | null,
    scope: import("./dashboard-read.port").DashboardCursorScope,
    endpoint: DashboardEndpoint,
  ) {
    if (!next || !scope.sessionId) return result;
    if (endpoint !== "overview" && endpoint !== "posture")
      return this.pageCursor(result, endpoint, next, scope);
    return ["obligations", "readiness", "ingestion"].reduce(
      (current, source) => {
        const position = next[source];
        if (
          !position ||
          typeof position !== "object" ||
          Array.isArray(position)
        )
          return current;
        const filters = {
          limit: 20,
          ...(source === "obligations"
            ? { state: endpoint === "posture" ? "history" : "active" }
            : {}),
          ...(scope.filters.productId
            ? { productId: scope.filters.productId }
            : {}),
        };
        return this.pageCursor(
          current,
          source,
          position as Record<string, unknown>,
          { ...scope, endpoint: source, filters },
        );
      },
      result,
    );
  }

  private pageCursor(
    result: Readonly<Record<string, unknown>>,
    endpoint: string,
    position: Readonly<Record<string, unknown>>,
    scope: import("./dashboard-read.port").DashboardCursorScope,
  ) {
    const page = result[endpoint];
    if (!page || typeof page !== "object" || !("data" in page)) return result;
    return {
      ...result,
      [endpoint]: {
        ...page,
        data: {
          ...(page.data as Record<string, unknown>),
          nextCursor: this.tokens.seal(scope, position),
        },
      },
    };
  }

  private diagnose(report: () => void) {
    try {
      report();
    } catch {
      // Observability cannot replace sanitized failures or erase healthy sections.
    }
  }

  private async permissionSnapshot(
    orgId: string,
    actorId: string,
    role: NonNullable<RequestUser["role"]>,
    endpoint: DashboardEndpoint,
  ) {
    try {
      const { version, permissions } = await this.permissions.snapshot(
        orgId,
        actorId,
        role,
      );
      if (!Number.isSafeInteger(version) || version <= 0)
        throw new DashboardUnavailableError();
      return { permissions, version };
    } catch (error) {
      if (error instanceof DashboardForbiddenError) throw error;
      this.diagnose(() =>
        this.diagnostics?.readUnavailable?.(endpoint, "permission_snapshot"),
      );
      throw new DashboardUnavailableError("Dashboard temporarily unavailable");
    }
  }
}

function withhold(
  result: Readonly<Record<string, unknown>>,
  access: ReturnType<typeof dashboardSourceAccess>,
) {
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => {
      const source = key === "feedFreshness" ? "feeds" : key;
      return [
        key,
        source in access && !access[source as keyof typeof access]
          ? restricted
          : value,
      ];
    }),
  );
}
