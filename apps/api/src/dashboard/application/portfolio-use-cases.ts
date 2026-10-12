import { createHash } from "node:crypto";
import { z } from "zod";
import { hasPermission } from "@repo/contracts/permissions";
import {
  portfolioProductsResponseSchema,
  portfolioConcentrationResponseSchema,
  portfolioDetailResponseSchema,
} from "@repo/contracts/dashboard/schemas";
import type {
  PortfolioProductsQuery,
  PortfolioConcentrationQuery,
  PortfolioDetailQuery,
} from "@repo/contracts/dashboard/types";
import type { RequestUser } from "../../auth/auth.types";
import { dashboardSourceAccess } from "../domain/dashboard-access.policy";
import {
  DashboardForbiddenError,
  DashboardInvalidCursorError,
  DashboardUnavailableError,
  type DashboardPermissionsPort,
  type DashboardTokens,
  type DashboardCursorScope,
} from "./dashboard-read.port";
import {
  PortfolioScopeChangedError,
  type PortfolioReadPort,
  type PortfolioEndpoint,
} from "./portfolio-read.port";
const record = z.record(z.string(), z.unknown());
const projectionSchema = z
  .object({
    result: record,
    nextPosition: record.nullable(),
    revision: z.string().min(1).max(128),
  })
  .strict();
const cursorSchema = z
  .object({ revision: z.string().min(1).max(128), position: record })
  .strict();
const componentSchema = z
  .object({
    revision: z.string().min(1).max(128),
    identityDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const hidden = {
  state: "restricted",
  observedAt: null,
  updatedAt: null,
} as const;

/** Composes current source policies with snapshot-bound, session-scoped pagination. */
export class PortfolioUseCases {
  constructor(
    private readonly repository: PortfolioReadPort,
    private readonly permissions: DashboardPermissionsPort,
    private readonly tokens: DashboardTokens,
  ) {}
  products(user: RequestUser, query: PortfolioProductsQuery) {
    return this.read(user, "products", query, portfolioProductsResponseSchema);
  }
  concentration(user: RequestUser, query: PortfolioConcentrationQuery) {
    return this.read(
      user,
      "concentration",
      query,
      portfolioConcentrationResponseSchema,
    );
  }
  detail(user: RequestUser, query: PortfolioDetailQuery) {
    return this.read(user, "detail", query, portfolioDetailResponseSchema);
  }
  private async read<T extends z.ZodType>(
    user: RequestUser,
    endpoint: PortfolioEndpoint,
    query: Readonly<Record<string, unknown>>,
    schema: T,
  ): Promise<z.output<T>> {
    if (!user.isActive || !user.organizationId || !user.role || !user.sessionId)
      throw new DashboardForbiddenError();
    const snapshot = await this.snapshot(user);
    if (
      !hasPermission(snapshot.permissions, "can_view_dashboards") ||
      !hasPermission(snapshot.permissions, "can_view_products")
    )
      throw new DashboardForbiddenError();
    const access = dashboardSourceAccess(snapshot.permissions);
    if (endpoint === "detail" && !access.sbomCoverage)
      throw new DashboardForbiddenError();
    const { cursor, componentRef, ...filters } = query;
    const common = {
      organizationId: user.organizationId,
      actorId: user.id,
      sessionId: user.sessionId ?? "",
      permissionFingerprint: this.tokens.fingerprint(snapshot),
      filters,
    };
    const componentScope = {
      ...common,
      endpoint: "portfolio/component",
      filters: componentFilters(filters),
    };
    const scope: DashboardCursorScope = {
      ...common,
      endpoint: `portfolio/${endpoint}`,
      filters: { ...filters, ...(componentRef ? { componentRef } : {}) },
    };
    const continuation = cursor
      ? this.open(cursor, scope, cursorSchema)
      : undefined;
    const component = componentRef
      ? this.open(componentRef, componentScope, componentSchema)
      : undefined;
    if (
      continuation &&
      component &&
      continuation.revision !== component.revision
    )
      throw new PortfolioScopeChangedError();
    const raw = await this.repository.read(user.organizationId, {
      actorId: user.id,
      endpoint,
      filters: {
        ...filters,
        sourceAccess: access,
        ...(continuation ? { position: continuation.position } : {}),
        ...(continuation || component
          ? { expectedRevision: continuation?.revision ?? component?.revision }
          : {}),
        ...(component
          ? {
              component: {
                identityDigest: component.identityDigest,
              },
            }
          : {}),
      },
    });
    try {
      const projection = projectionSchema.parse(raw);
      if (projection.result.organizationId !== user.organizationId)
        throw new Error();
      if (
        (continuation || component) &&
        projection.revision !== (continuation?.revision ?? component?.revision)
      )
        throw new PortfolioScopeChangedError();
      let result = withhold(projection.result, access);
      const pageKey = endpoint === "detail" ? "affectedReleases" : endpoint;
      const page = result[pageKey] as
        | {
            state: string;
            data?: { rows: Record<string, unknown>[]; nextCursor: unknown };
          }
        | undefined;
      if (page?.data) {
        if (page.data.nextCursor !== null) throw new Error();
        if (["products", "detail"].includes(endpoint)) {
          for (const row of page.data.rows) {
            if (
              (filters.productId && row.productId !== filters.productId) ||
              (filters.legalEntityId &&
                row.legalEntityId !== filters.legalEntityId)
            )
              throw new Error();
          }
        }
        const rows = page.data.rows.map((row) =>
          endpoint === "concentration"
            ? {
                ...row,
                componentRef: user.sessionId
                  ? this.tokens.seal(componentScope, {
                      revision: projection.revision,
                      identityDigest: identityDigest(row),
                    })
                  : null,
              }
            : row,
        );
        result = {
          ...result,
          [pageKey]: {
            ...page,
            data: {
              ...page.data,
              rows,
              nextCursor:
                projection.nextPosition && user.sessionId
                  ? this.tokens.seal(scope, {
                      revision: projection.revision,
                      position: projection.nextPosition,
                    })
                  : null,
            },
          },
        };
      }
      if (endpoint === "detail") {
        const identity = result.component as Record<string, unknown>;
        if (identityDigest(identity) !== component?.identityDigest)
          throw new Error();
        result = { ...result, component: { ...identity, componentRef } };
      }
      const expectedScope = {
        legalEntityId: filters.legalEntityId ?? null,
        productId: filters.productId ?? null,
        includeArchived: filters.includeArchived,
      };
      if (
        this.tokens.fingerprint(result.scope) !==
        this.tokens.fingerprint(expectedScope)
      )
        throw new Error();
      return schema.parse(result);
    } catch (error) {
      if (error instanceof PortfolioScopeChangedError) throw error;
      throw new DashboardUnavailableError("Portfolio temporarily unavailable");
    }
  }
  private open<T extends z.ZodType>(
    token: unknown,
    scope: DashboardCursorScope,
    schema: T,
  ): z.output<T> {
    try {
      if (typeof token !== "string" || !scope.sessionId) throw new Error();
      return schema.parse(this.tokens.open(token, scope));
    } catch {
      throw new DashboardInvalidCursorError("Invalid portfolio cursor");
    }
  }
  private async snapshot(user: RequestUser) {
    try {
      const snapshot = await this.permissions.snapshot(
        user.organizationId!,
        user.id,
        user.role!,
      );
      if (!Number.isSafeInteger(snapshot.version) || snapshot.version <= 0)
        throw new Error();
      return snapshot;
    } catch (error) {
      if (error instanceof DashboardForbiddenError) throw error;
      throw new DashboardUnavailableError("Portfolio temporarily unavailable");
    }
  }
}
function componentFilters(filters: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(filters).filter(([key]) => key !== "limit"),
  );
}
function withhold(
  result: Record<string, unknown>,
  access: ReturnType<typeof dashboardSourceAccess>,
): Record<string, unknown> {
  const protectRow = (row: Record<string, unknown>) => ({
    ...row,
    ...(row.findings && !access.findings ? { findings: hidden } : {}),
    ...(row.readiness && !access.readiness ? { readiness: hidden } : {}),
    ...(row.sbomCoverage && !access.sbomCoverage
      ? { sbomCoverage: hidden }
      : {}),
  });
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => {
      if (
        ([
          "coverage",
          "matchingCoverage",
          "concentration",
          "affectedReleases",
        ].includes(key) &&
          !access.sbomCoverage) ||
        (key === "matchingCoverage" && !access.findings) ||
        (key === "feedFreshness" && !access.feeds)
      )
        return [key, hidden];
      if (
        ["products", "concentration", "affectedReleases"].includes(key) &&
        value &&
        typeof value === "object" &&
        "data" in value
      ) {
        const section = value as { data: { rows: Record<string, unknown>[] } };
        return [
          key,
          {
            ...section,
            data: { ...section.data, rows: section.data.rows.map(protectRow) },
          },
        ];
      }
      return [key, value];
    }),
  );
}

function identityDigest(row: Readonly<Record<string, unknown>>): string {
  if (
    typeof row.packageIdentity !== "string" ||
    typeof row.version !== "string"
  )
    throw new Error();
  return createHash("sha256")
    .update(
      `${Buffer.byteLength(row.packageIdentity)}:${row.packageIdentity}${row.version}`,
    )
    .digest("hex");
}
