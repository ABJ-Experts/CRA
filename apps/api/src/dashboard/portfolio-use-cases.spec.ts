import { PortfolioScopeChangedError } from "./application/portfolio-read.port";
import { PortfolioUseCases } from "./application/portfolio-use-cases";
import { DashboardForbiddenError } from "./application/dashboard-read.port";
import { DashboardCursorCodec } from "./infrastructure/dashboard-cursor";
import type { RequestUser } from "../auth/auth.types";

describe("portfolio authorization", () => {
  it("rejects inactive identities before permission or projection queries", async () => {
    const read = jest.fn();
    const snapshot = jest.fn();
    const service = new PortfolioUseCases(
      { read },
      { snapshot },
      new DashboardCursorCodec("test"),
    );
    await expect(
      service.products({ isActive: false } as RequestUser, {
        includeArchived: false,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(DashboardForbiddenError);
    expect(read).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });
});

const id = "11111111-1111-4111-8111-111111111111";
const user = {
  id,
  organizationId: id,
  role: "owner",
  sessionId: id,
  isActive: true,
} as RequestUser;
const hidden = { state: "restricted", observedAt: null, updatedAt: null };
const base = {
  organizationId: id,
  serverNow: "2026-10-12T12:00:00Z",
  generatedAt: "2026-10-12T12:00:00Z",
  scope: { productId: null, legalEntityId: null, includeArchived: false },
  coverage: hidden,
  matchingCoverage: hidden,
  feedFreshness: hidden,
};
const query = { includeArchived: false, limit: 20 };

describe("portfolio projection boundaries", () => {
  const read = jest.fn();
  const snapshot = jest.fn();
  const tokens = new DashboardCursorCodec("test-only");
  const service = new PortfolioUseCases({ read }, { snapshot }, tokens);
  beforeEach(() => {
    read.mockReset().mockResolvedValue({
      result: { ...base, products: hidden },
      nextPosition: null,
      revision: "r1",
    });
    snapshot.mockReset().mockResolvedValue({
      version: 1,
      permissions: { can_view_dashboards: true, can_view_products: true },
    });
  });
  it("takes a fresh permission snapshot and gates sources before the org-first RPC", async () => {
    expect(await service.products(user, query)).toEqual({
      ...base,
      products: hidden,
    });
    expect(snapshot).toHaveBeenCalledWith(id, id, "owner");
    const call = read.mock.calls[0] as unknown as [
      string,
      { actorId: string; endpoint: string; filters: Record<string, unknown> },
    ];
    expect(call[0]).toBe(id);
    expect(call[1]).toMatchObject({
      actorId: id,
      endpoint: "products",
      filters: {
        sourceAccess: { products: true, findings: false, sbomCoverage: false },
      },
    });
  });
  it("rejects absent dashboard or product permission", async () => {
    for (const permissions of [
      { can_view_dashboards: true },
      { can_view_products: true },
      {},
    ]) {
      snapshot.mockResolvedValueOnce({ version: 1, permissions });
      await expect(service.products(user, query)).rejects.toBeInstanceOf(
        DashboardForbiddenError,
      );
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects missing identity scope or role", async () => {
    for (const change of [
      { organizationId: null },
      { role: null },
      { sessionId: undefined },
    ])
      await expect(
        service.products({ ...user, ...change }, query),
      ).rejects.toBeInstanceOf(DashboardForbiddenError);
  });
  it("does not disclose untrusted projection or snapshot errors", async () => {
    snapshot.mockRejectedValueOnce(new Error("secret"));
    await expect(service.products(user, query)).rejects.toThrow(
      "Portfolio temporarily unavailable",
    );
    snapshot.mockResolvedValueOnce({ version: 0, permissions: {} });
    await expect(service.products(user, query)).rejects.toThrow(
      "Portfolio temporarily unavailable",
    );
    read.mockResolvedValueOnce({
      result: { ...base, organizationId: "foreign", products: hidden },
      nextPosition: null,
      revision: "r1",
    });
    await expect(service.products(user, query)).rejects.toThrow(
      "Portfolio temporarily unavailable",
    );
  });
});

describe("portfolio encrypted continuation", () => {
  const read = jest.fn();
  const snapshot = jest.fn();
  const tokens = new DashboardCursorCodec("test-only");
  const service = new PortfolioUseCases({ read }, { snapshot }, tokens);
  const section = (data: unknown) => ({
    state: "available",
    observedAt: base.serverNow,
    updatedAt: base.serverNow,
    data,
  });
  const component = {
    packageIdentity: "pkg:npm/example",
    version: "1",
    componentRef: "raw",
    productCount: 2,
    releaseCount: 2,
    findings: hidden,
  };
  beforeEach(() => {
    read.mockReset();
    snapshot.mockReset().mockResolvedValue({
      version: 1,
      permissions: {
        can_view_dashboards: true,
        can_view_products: true,
        can_view_sboms: true,
      },
    });
  });
  async function concentration() {
    read.mockResolvedValueOnce({
      result: {
        ...base,
        concentration: section({ rows: [component], nextCursor: null }),
      },
      nextPosition: {
        productCount: 2,
        releaseCount: 2,
        packageIdentity: component.packageIdentity,
        version: "1",
      },
      revision: "r1",
    });
    return service.concentration(user, query);
  }
  it("seals component references and cursor, then revalidates the frozen revision", async () => {
    const result = await concentration();
    if (!("data" in result.concentration)) throw new Error();
    const row = result.concentration.data.rows[0]!;
    expect(row.componentRef).not.toBe("raw");
    read.mockReset().mockResolvedValue({
      result: {
        ...base,
        component: {
          packageIdentity: component.packageIdentity,
          version: "1",
          componentRef: "raw",
          productCount: 2,
          releaseCount: 2,
        },
        affectedReleases: hidden,
      },
      nextPosition: null,
      revision: "r1",
    });
    expect(
      (
        await service.detail(user, {
          ...query,
          limit: 1,
          componentRef: row.componentRef,
        })
      ).component.componentRef,
    ).toEqual(row.componentRef);
    const call = read.mock.calls[0] as unknown as [
      string,
      {
        filters: {
          expectedRevision: string;
          component: { identityDigest: string };
        };
      },
    ];
    expect(call[0]).toBe(id);
    expect(call[1].filters.expectedRevision).toBe("r1");
    expect(call[1].filters.component.identityDigest).toMatch(/^[a-f0-9]{64}$/);
    read.mockResolvedValueOnce({
      result: { ...base, concentration: hidden },
      nextPosition: null,
      revision: "r1",
    });
    await service.concentration(user, {
      ...query,
      cursor: result.concentration.data.nextCursor!,
    });
    const last = read.mock.calls.at(-1) as unknown as [
      string,
      { filters: Record<string, unknown> },
    ];
    expect(last[1].filters).toMatchObject({
      expectedRevision: "r1",
      position: { version: "1" },
    });
  });
  it("rejects changed data, cross-session tokens, missing sessions and malformed references", async () => {
    const result = await concentration();
    if (!("data" in result.concentration)) throw new Error();
    const token = result.concentration.data.rows[0]!.componentRef;
    read.mockResolvedValue({
      result: { ...base, concentration: hidden },
      nextPosition: null,
      revision: "r2",
    });
    await expect(
      service.concentration(user, {
        ...query,
        cursor: result.concentration.data.nextCursor!,
      }),
    ).rejects.toBeInstanceOf(PortfolioScopeChangedError);
    for (const identity of [{ ...user, sessionId: "other" }])
      await expect(
        service.detail(identity, { ...query, componentRef: token }),
      ).rejects.toThrow("Invalid portfolio cursor");
    await expect(
      service.detail(user, { ...query, componentRef: "invalid" }),
    ).rejects.toThrow("Invalid portfolio cursor");
  });
  it("withholds provider sections and rows when their source permissions are denied", async () => {
    snapshot.mockResolvedValue({
      version: 1,
      permissions: { can_view_dashboards: true, can_view_products: true },
    });
    read.mockResolvedValue({
      result: {
        ...base,
        coverage: { secret: true },
        matchingCoverage: { secret: true },
        feedFreshness: { secret: true },
        products: section({
          rows: [
            {
              productId: id,
              productName: "P",
              archived: false,
              classification: null,
              support: { state: "missing", startsAt: null, endsAt: null },
              legalEntityId: null,
              legalEntityName: null,
              sbomCoverage: { secret: true },
              findings: { secret: true },
              readiness: { secret: true },
            },
          ],
          nextCursor: null,
        }),
      },
      nextPosition: null,
      revision: "r1",
    });
    const result = await service.products(user, query);
    expect(JSON.stringify(result)).not.toContain("secret");
    await expect(
      service.detail(user, { ...query, componentRef: "invalid" }),
    ).rejects.toBeInstanceOf(DashboardForbiddenError);
  });
  it("rejects invalid wire schemas, foreign filters, internal cursors and wrong component identity", async () => {
    for (const result of [
      { ...base, products: { bad: true } },
      {
        ...base,
        scope: { ...base.scope, includeArchived: true },
        products: hidden,
      },
      { ...base, products: section({ rows: [], nextCursor: "raw" }) },
    ]) {
      read.mockResolvedValueOnce({
        result,
        nextPosition: null,
        revision: "r1",
      });
      await expect(service.products(user, query)).rejects.toThrow(
        "Portfolio temporarily unavailable",
      );
    }
    const result = await concentration();
    if (!("data" in result.concentration)) throw new Error();
    read.mockResolvedValueOnce({
      result: {
        ...base,
        component: { ...component, version: "2" },
        affectedReleases: hidden,
      },
      nextPosition: null,
      revision: "r1",
    });
    await expect(
      service.detail(user, {
        ...query,
        componentRef: result.concentration.data.rows[0]!.componentRef,
      }),
    ).rejects.toThrow("Portfolio temporarily unavailable");
  });
});

describe("portfolio scope and bounded references", () => {
  const snapshot = jest.fn().mockResolvedValue({
    version: 1,
    permissions: {
      can_view_dashboards: true,
      can_view_products: true,
      can_view_sboms: true,
    },
  });
  const read = jest.fn();
  const tokens = new DashboardCursorCodec("test");
  const service = new PortfolioUseCases({ read }, { snapshot }, tokens);
  const section = (data: unknown) => ({
    state: "available",
    observedAt: base.serverNow,
    updatedAt: base.serverNow,
    data,
  });
  it("keeps long canonical identities out of tokens without conflating versions", async () => {
    const packageIdentity = `pkg:npm/${"x".repeat(4000)}`;
    read.mockResolvedValueOnce({
      result: {
        ...base,
        concentration: section({
          rows: [
            {
              packageIdentity,
              version: "1",
              componentRef: "raw",
              productCount: 2,
              releaseCount: 2,
              findings: hidden,
            },
          ],
          nextCursor: null,
        }),
      },
      nextPosition: {
        productCount: 2,
        releaseCount: 2,
        identityDigest: "f".repeat(64),
      },
      revision: "r1",
    });
    const result = await service.concentration(user, query);
    if (!("data" in result.concentration)) throw new Error();
    const ref = result.concentration.data.rows[0]!.componentRef;
    expect(ref.length).toBeLessThan(2048);
    expect(result.concentration.data.nextCursor!.length).toBeLessThan(2048);
    read.mockResolvedValueOnce({
      result: {
        ...base,
        component: {
          packageIdentity,
          version: "1",
          componentRef: "raw",
          productCount: 2,
          releaseCount: 2,
        },
        affectedReleases: hidden,
      },
      nextPosition: null,
      revision: "r1",
    });
    expect(
      (await service.detail(user, { ...query, componentRef: ref })).component
        .packageIdentity,
    ).toBe(packageIdentity);
  });
  it("does not trust a matching response scope with foreign product rows", async () => {
    read.mockResolvedValueOnce({
      result: {
        ...base,
        scope: { ...base.scope, productId: id },
        products: section({
          rows: [{ productId: "foreign" }],
          nextCursor: null,
        }),
      },
      nextPosition: null,
      revision: "r1",
    });
    await expect(
      service.products(user, { ...query, productId: id }),
    ).rejects.toThrow("Portfolio temporarily unavailable");
    read.mockResolvedValueOnce({
      result: {
        ...base,
        scope: { ...base.scope, legalEntityId: id },
        products: section({
          rows: [{ legalEntityId: "foreign" }],
          nextCursor: null,
        }),
      },
      nextPosition: null,
      revision: "r1",
    });
    await expect(
      service.products(user, { ...query, legalEntityId: id }),
    ).rejects.toThrow("Portfolio temporarily unavailable");
  });
  it("withholds concentration after SBOM permission loss without suppressing product metadata", async () => {
    snapshot.mockResolvedValueOnce({
      version: 1,
      permissions: { can_view_dashboards: true, can_view_products: true },
    });
    read.mockResolvedValueOnce({
      result: { ...base, concentration: { private: true } },
      nextPosition: null,
      revision: "r1",
    });
    expect((await service.concentration(user, query)).concentration).toEqual(
      hidden,
    );
  });
});
