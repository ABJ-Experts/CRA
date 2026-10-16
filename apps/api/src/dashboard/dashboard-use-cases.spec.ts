import { DashboardUseCases } from "./application/dashboard-use-cases";
import {
  DashboardForbiddenError,
  DashboardNotFoundError,
  DashboardUnavailableError,
} from "./application/dashboard-read.port";
import { DashboardCursorCodec } from "./infrastructure/dashboard-cursor";
import type { RequestUser } from "../auth/auth.types";
const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-07T12:00:00Z";
const hidden = { state: "restricted", observedAt: null, updatedAt: null };
const overview = {
  organizationId: id,
  serverNow: now,
  generatedAt: now,
  products: hidden,
  findings: hidden,
  obligations: hidden,
  sbomCoverage: hidden,
  readiness: hidden,
  ingestion: hidden,
  feedFreshness: hidden,
};
const user = {
  id,
  organizationId: id,
  role: "owner",
  sessionId: id,
  isActive: true,
} as RequestUser;
describe("dashboard application", () => {
  const read = jest.fn<
    ReturnType<
      import("./application/dashboard-read.port").DashboardReadPort["read"]
    >,
    Parameters<
      import("./application/dashboard-read.port").DashboardReadPort["read"]
    >
  >();
  const effectivePermissions = jest.fn<
    Promise<import("@repo/contracts/permissions").PermissionSet>,
    [string, string, string]
  >();
  const version = jest.fn<Promise<number>, [string]>().mockResolvedValue(1);
  const snapshot = jest.fn();
  const tokens = new DashboardCursorCodec("test-only");
  const useCases = new DashboardUseCases({ read }, { snapshot }, tokens);
  beforeEach(() => {
    read.mockReset();
    version.mockReset().mockResolvedValue(1);
    effectivePermissions.mockResolvedValue({ can_view_dashboards: true });
    snapshot
      .mockReset()
      .mockImplementation(
        async (orgId: string, actorId: string, role: "owner") => ({
          version: await version(orgId),
          permissions: await effectivePermissions(orgId, actorId, role),
        }),
      );
    read.mockResolvedValue({ result: overview, nextPosition: null });
  });
  it("fails closed on rejected, invalid, or unavailable coherent snapshots", async () => {
    snapshot.mockRejectedValueOnce(new DashboardUnavailableError());
    await expect(useCases.overview(user, {})).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
    version.mockResolvedValue(0);
    await expect(useCases.overview(user, {})).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
    version.mockRejectedValue(new Error("provider detail"));
    await expect(useCases.overview(user, {})).rejects.toThrow(
      "Dashboard temporarily unavailable",
    );
    expect(read).not.toHaveBeenCalled();
  });
  it.each(["version", "permissions", "response"])(
    "classifies %s failure without exposing provider data",
    async (failure) => {
      const report = jest.fn();
      const isolated = new DashboardUseCases({ read }, { snapshot }, tokens, {
        sectionUnavailable: jest.fn(),
        readUnavailable: report,
      });
      if (failure === "version")
        version.mockRejectedValue(new Error("secret-canary"));
      else if (failure === "permissions")
        effectivePermissions.mockRejectedValueOnce(new Error("secret-canary"));
      else
        read.mockResolvedValue({
          result: { ...overview, serverNow: "secret-canary" },
          nextPosition: null,
        });
      await expect(isolated.overview(user, {})).rejects.toThrow(
        "Dashboard temporarily unavailable",
      );
      expect(report).toHaveBeenCalledWith(
        "overview",
        failure === "response" ? "response_validation" : "permission_snapshot",
      );
      expect(JSON.stringify(report.mock.calls)).not.toContain("secret-canary");
    },
  );
  it.each(["permission", "response", "section"])(
    "contains a throwing diagnostic sink during %s failure",
    async (phase) => {
      const fail = () => {
        throw new Error("secret-diagnostic-failure");
      };
      const isolated = new DashboardUseCases({ read }, { snapshot }, tokens, {
        sectionUnavailable: fail,
        readUnavailable: fail,
      });
      if (phase === "permission")
        version.mockRejectedValue(new Error("secret-provider-failure"));
      else if (phase === "response")
        read.mockResolvedValue({
          result: { ...overview, serverNow: "invalid" },
          nextPosition: null,
        });
      else {
        effectivePermissions.mockResolvedValue({
          can_view_dashboards: true,
          can_view_products: true,
        });
        read.mockResolvedValue({
          result: {
            ...overview,
            products: { state: "available", data: "invalid" },
          },
          nextPosition: null,
        });
      }
      if (phase === "section") {
        const result = await isolated.overview(user, {});
        expect(result.products.state).toBe("unavailable");
        expect(result.findings).toEqual(hidden);
      } else
        await expect(isolated.overview(user, {})).rejects.toThrow(
          "Dashboard temporarily unavailable",
        );
    },
  );
  it("uses one mandatory coherent snapshot per read and preserves definitive denial", async () => {
    await useCases.overview(user, {});
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith(id, id, "owner");
    read.mockClear();
    snapshot.mockRejectedValueOnce(new DashboardForbiddenError());
    await expect(useCases.overview(user, {})).rejects.toBeInstanceOf(
      DashboardForbiddenError,
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("binds unchanged permissions to the current version", async () => {
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
      can_view_technical_files: true,
    });
    read.mockResolvedValue({
      result: {
        organizationId: id,
        serverNow: now,
        generatedAt: now,
        readiness: {
          state: "empty",
          observedAt: now,
          updatedAt: null,
          data: { rows: [], nextCursor: null },
        },
      },
      nextPosition: { id },
    });
    const first = await useCases.readiness(user, { limit: 20 });
    if (!("data" in first.readiness)) throw new Error();
    version.mockResolvedValue(2);
    await expect(
      useCases.readiness(user, {
        limit: 20,
        cursor: first.readiness.data.nextCursor!,
      }),
    ).rejects.toThrow("Invalid dashboard cursor");
  });
  it("seals initial source positions for their dedicated page filters", async () => {
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
      can_view_technical_files: true,
      can_view_findings: true,
      can_view_sboms: true,
    });
    const section = {
      state: "empty",
      observedAt: now,
      updatedAt: null,
      data: { rows: [], nextCursor: null },
    };
    read.mockResolvedValue({
      result: {
        ...overview,
        readiness: section,
        obligations: section,
        ingestion: section,
      },
      nextPosition: {
        readiness: { id },
        obligations: { id },
        ingestion: { id },
      },
    });
    const first = await useCases.overview(user, {});
    for (const source of ["readiness", "obligations", "ingestion"] as const) {
      const page = first[source];
      if (!("data" in page)) throw new Error();
      read.mockResolvedValue({
        result: {
          organizationId: id,
          serverNow: now,
          generatedAt: now,
          [source]: section,
        },
        nextPosition: null,
      });
      const query = {
        limit: 20,
        cursor: page.data.nextCursor!,
        ...(source === "obligations" ? { state: "active" as const } : {}),
      };
      await useCases[source](user, query as never);
      expect(read.mock.calls.at(-1)?.[1].filters.position).toEqual({ id });
    }
  });
  it("parses product posture and rejects a mismatched product", async () => {
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
    });
    const sections = Object.fromEntries(
      Object.entries(overview).filter(([key]) => key !== "products"),
    );
    const product = {
      productId: id,
      productName: "Product",
      archived: false,
      classification: null,
      support: { state: "missing", startsAt: null, endsAt: null },
    };
    read.mockResolvedValue({
      result: { ...sections, product },
      nextPosition: null,
    });
    expect(
      (await useCases.posture(user, { productId: id }, {})).product.productId,
    ).toBe(id);
    await expect(
      useCases.posture(
        user,
        { productId: "22222222-2222-4222-8222-222222222222" },
        {},
      ),
    ).rejects.toBeInstanceOf(DashboardUnavailableError);
  });
  it("binds posture obligation continuation to product history", async () => {
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
      can_view_findings: true,
    });
    const sections = Object.fromEntries(
      Object.entries(overview).filter(([key]) => key !== "products"),
    );
    const section = {
      state: "empty",
      observedAt: now,
      updatedAt: null,
      data: { rows: [], nextCursor: null },
    };
    const product = {
      productId: id,
      productName: "Product",
      archived: false,
      classification: null,
      support: { state: "missing", startsAt: null, endsAt: null },
    };
    read.mockResolvedValue({
      result: { ...sections, product, obligations: section },
      nextPosition: { obligations: { id } },
    });
    const first = await useCases.posture(user, { productId: id }, {});
    if (!("data" in first.obligations)) throw new Error();
    read.mockResolvedValue({
      result: {
        organizationId: id,
        serverNow: now,
        generatedAt: now,
        obligations: section,
      },
      nextPosition: null,
    });
    await useCases.obligations(user, {
      limit: 20,
      productId: id,
      state: "history",
      cursor: first.obligations.data.nextCursor!,
    });
    expect(read.mock.calls.at(-1)?.[1].filters).toMatchObject({
      state: "history",
      productId: id,
      position: { id },
    });
  });
  it("isolates malformed source sections and reports only a safe classification", async () => {
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
      can_view_findings: true,
    });
    const products = {
      state: "available",
      observedAt: now,
      updatedAt: null,
      data: { totalProducts: 1, activeProducts: 1, archivedProducts: 0 },
    };
    read.mockResolvedValue({
      result: {
        ...overview,
        products,
        findings: {
          state: "available",
          observedAt: now,
          updatedAt: null,
          data: { openCount: -1, privateProviderDetail: "do not log" },
        },
      },
      nextPosition: null,
    });
    const report = jest.fn();
    const isolated = new DashboardUseCases({ read }, { snapshot }, tokens, {
      sectionUnavailable: report,
    });
    const result = await isolated.overview(user, {});
    expect(result.products).toEqual(products);
    expect(result.findings).toEqual({
      state: "unavailable",
      observedAt: null,
      updatedAt: null,
    });
    expect(report).toHaveBeenCalledWith(
      "findings",
      "provider_contract_invalid",
    );
    expect(JSON.stringify(report.mock.calls)).not.toContain(
      "privateProviderDetail",
    );
  });
  it("never accepts a provider supplied browser cursor", async () => {
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
      can_view_technical_files: true,
    });
    read.mockResolvedValue({
      result: {
        ...overview,
        readiness: {
          state: "empty",
          observedAt: now,
          updatedAt: null,
          data: { rows: [], nextCursor: "provider_keyset" },
        },
      },
      nextPosition: null,
    });
    expect((await useCases.overview(user, {})).readiness).toEqual({
      state: "unavailable",
      observedAt: null,
      updatedAt: null,
    });
  });
  it("keeps dedicated page bounds and does not swallow a programming failure", async () => {
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
      can_view_technical_files: true,
    });
    const rows = Array.from({ length: 20 }, () => ({
      productId: id,
      productName: "Product",
      state: "not_initialized",
    }));
    read.mockResolvedValue({
      result: {
        organizationId: id,
        serverNow: now,
        generatedAt: now,
        readiness: {
          state: "available",
          observedAt: now,
          updatedAt: null,
          data: { rows, nextCursor: null },
        },
      },
      nextPosition: { id },
    });
    const result = await useCases.readiness(user, { limit: 20 });
    expect(
      "data" in result.readiness && result.readiness.data.rows,
    ).toHaveLength(20);
    const brokenTokens = {
      fingerprint: tokens.fingerprint.bind(tokens),
      open: tokens.open.bind(tokens),
      seal: () => {
        throw new TypeError("programming error");
      },
    };
    const broken = new DashboardUseCases({ read }, { snapshot }, brokenTokens);
    await expect(broken.readiness(user, { limit: 20 })).rejects.toThrow(
      "programming error",
    );
  });
  it("scopes before aggregates and suppresses forbidden source data", async () => {
    read.mockResolvedValue({
      result: {
        ...overview,
        findings: {
          state: "available",
          observedAt: now,
          updatedAt: now,
          data: {
            openCount: 9,
            suppressedOpenCount: 0,
            bySeverity: { critical: 9, high: 0, medium: 0, low: 0, unknown: 0 },
          },
        },
      },
      nextPosition: null,
    });
    expect((await useCases.overview(user, {})).findings).toEqual(hidden);
    expect(read.mock.calls[0]?.[0]).toBe(id);
    expect(read.mock.calls[0]?.[1].actorId).toBe(id);
    expect(
      (read.mock.calls[0]?.[1].filters.sourceAccess as { findings: boolean })
        .findings,
    ).toBe(false);
  });
  it.each([
    { ...user, organizationId: null },
    { ...user, role: null },
    { ...user, isActive: false },
  ])("rejects absent active scope", async (actor) => {
    await expect(useCases.overview(actor, {})).rejects.toBeInstanceOf(
      DashboardForbiddenError,
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("checks dashboard and posture permissions on every call", async () => {
    effectivePermissions.mockResolvedValue({});
    await expect(useCases.overview(user, {})).rejects.toBeInstanceOf(
      DashboardForbiddenError,
    );
    effectivePermissions.mockResolvedValue({ can_view_dashboards: true });
    await expect(
      useCases.posture(user, { productId: id }, {}),
    ).rejects.toBeInstanceOf(DashboardNotFoundError);
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    { ...overview, organizationId: "22222222-2222-4222-8222-222222222222" },
    { ...overview, serverNow: "bad" },
  ])("rejects corrupt or foreign provider response", async (result) => {
    read.mockResolvedValue({ result, nextPosition: null });
    await expect(useCases.overview(user, {})).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
  });
  it("reauthorizes cursors, retains canonical filters and seals next keyset", async () => {
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
      can_view_technical_files: true,
    });
    const result = {
      organizationId: id,
      serverNow: now,
      generatedAt: now,
      readiness: {
        state: "empty",
        observedAt: now,
        updatedAt: null,
        data: { rows: [], nextCursor: null },
      },
    };
    read.mockResolvedValue({ result, nextPosition: { id } });
    const first = await useCases.readiness(user, { limit: 20 });
    if (!("data" in first.readiness)) throw new Error();
    const cursor = first.readiness.data.nextCursor!;
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    await useCases.readiness(user, { limit: 20, cursor });
    expect(read.mock.calls[1]?.[1].filters.position).toEqual({ id });
    effectivePermissions.mockResolvedValue({
      can_view_dashboards: true,
      can_view_products: true,
    });
    await expect(
      useCases.readiness(user, { limit: 20, cursor }),
    ).rejects.toThrow("Invalid dashboard cursor");
  });
  it("serves bounded obligations and ingestion, and disables cursor without session", async () => {
    for (const endpoint of ["obligations", "ingestion"] as const) {
      read.mockResolvedValue({
        result: {
          organizationId: id,
          serverNow: now,
          generatedAt: now,
          [endpoint]: hidden,
        },
        nextPosition: null,
      });
      expect(
        await useCases[endpoint](
          user,
          endpoint === "obligations"
            ? { limit: 20, state: "active" }
            : ({ limit: 20 } as never),
        ),
      ).toBeDefined();
    }
    await expect(
      useCases.readiness(
        { ...user, sessionId: undefined },
        { limit: 20, cursor: "abc" },
      ),
    ).rejects.toThrow("Invalid dashboard cursor");
  });
});
