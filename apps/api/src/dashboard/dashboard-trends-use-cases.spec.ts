import { DEFAULT_PERMISSIONS_BY_ROLE } from "@repo/contracts/permissions";
import type { RequestUser } from "../auth/auth.types";
import { DashboardTrendsUseCases } from "./application/dashboard-trends-use-cases";
import { DashboardDatasetCodec } from "./infrastructure/dashboard-dataset-codec";
import {
  DashboardForbiddenError,
  DashboardUnavailableError,
} from "./application/dashboard-read.port";
import { DashboardDatasetConflictError } from "./application/dashboard-trends.port";
const id = "00000000-0000-4000-8000-000000000001";
const user: RequestUser = {
  id,
  authUserId: id,
  email: "owner@cra.test",
  isActive: true,
  organizationId: id,
  role: "owner",
  accessToken: "",
  aal: "aal2",
  sessionId: id,
};
const filters = {
  from: "2026-10-01",
  to: "2026-10-08",
  timezone: "UTC",
  bucket: "day" as const,
};
const pin = {
  snapshot: "1:2:",
  maxFindingSequence: "1",
  maxCoverageSequence: "1",
  maxSnapshotSequence: "1",
  epoch: id,
  cutoffAt: "2026-10-08T00:00:00Z",
};
const series = (unit: string) => ({
  state: "unavailable",
  reason: "history_unavailable",
  unit,
  baselineAt: null,
  buckets: [],
});
const data = () => ({
  organizationId: id,
  filters,
  policyVersion: "m14-02-v1",
  datasetRevision: "revision",
  generatedAt: "2026-10-08T00:00:00Z",
  baselineAt: null,
  series: {
    activity: series("count"),
    triage: series("hours"),
    remediation: series("days"),
    sbomCoverage: series("percent"),
    readiness: series("percent"),
  },
});
function fixture() {
  const read = jest.fn().mockResolvedValue({ result: data(), snapshot: pin });
  const snapshot = jest.fn().mockResolvedValue({
    version: 1,
    permissions: DEFAULT_PERMISSIONS_BY_ROLE.owner,
  });
  const tokens = new DashboardDatasetCodec("secret");
  const api = new DashboardTrendsUseCases({ read }, { snapshot }, tokens);
  return { api, read, snapshot, tokens };
}
describe("trend application authorization and pinned reads", () => {
  it("reauthorizes each export once and rejects permission changes between requests", async () => {
    const { api, read, snapshot } = fixture();
    const initial = await api.trends(user, filters);
    snapshot.mockClear();
    await api.export(user, { datasetToken: initial.datasetToken });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith(
      user.organizationId,
      user.id,
      user.role,
    );
    read.mockClear();
    snapshot.mockResolvedValueOnce({
      version: 2,
      permissions: DEFAULT_PERMISSIONS_BY_ROLE.owner,
    });
    await expect(
      api.export(user, { datasetToken: initial.datasetToken }),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
    expect(read).not.toHaveBeenCalled();
    snapshot.mockResolvedValueOnce({
      version: 3,
      permissions: {
        ...DEFAULT_PERMISSIONS_BY_ROLE.owner,
        can_view_dashboards: false,
      },
    });
    await expect(
      api.export(user, { datasetToken: initial.datasetToken }),
    ).rejects.toBeInstanceOf(DashboardForbiddenError);
    expect(read).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledTimes(3);
  });
  it.each([999981, 999980])(
    "bounds continuation without discarding the valid page at offset %i",
    async (offset) => {
      const { api, read, tokens } = fixture();
      const initial = await api.trends(user, filters);
      const query = {
        datasetToken: initial.datasetToken,
        metric: "activity" as const,
        limit: 20,
      };
      const cursorScope = {
        organizationId: id,
        actorId: id,
        sessionId: id,
        permissionFingerprint: tokens.fingerprint({
          version: 1,
          permissions: DEFAULT_PERMISSIONS_BY_ROLE.owner,
        }),
        endpoint: "trendSources",
        filters: { ...query, datasetRevision: "revision" },
      };
      const items = Array.from({ length: 20 }, (_, index) => ({
        id: `finding-${index}-opened`,
        productId: id,
        sourceId: id,
        sourceType: "finding",
        factKind: "opened",
        effectiveAt: "2026-10-07T00:00:00Z",
        recordedAt: "2026-10-07T00:00:00Z",
        provenance: "source",
        href: null,
      }));
      read.mockResolvedValueOnce({
        result: { items, nextOffset: offset + 20, datasetRevision: "revision" },
        snapshot: pin,
      });
      const page = await api.sources(user, {
        ...query,
        cursor: tokens.seal(cursorScope, { offset }),
      });
      expect(page.items).toHaveLength(20);
      if (offset + 20 > 1000000) {
        expect(page.nextCursor).toBeNull();
        expect(page).toHaveProperty(
          "continuationUnavailable",
          "source_page_limit",
        );
      } else {
        expect(page).not.toHaveProperty("continuationUnavailable");
        expect(tokens.open(page.nextCursor!, cursorScope)).toEqual({
          offset: 1000000,
        });
        read.mockResolvedValueOnce({
          result: { items: [], nextOffset: null, datasetRevision: "revision" },
          snapshot: pin,
        });
        await expect(
          api.sources(user, { ...query, cursor: page.nextCursor! }),
        ).resolves.toHaveProperty("nextCursor", null);
      }
    },
  );
  it("returns stable opaque source IDs without leaking global fact sequences", async () => {
    const { api, read } = fixture();
    const initial = await api.trends(user, filters);
    const item = {
      id: "finding-918273645-opened",
      productId: id,
      sourceId: id,
      sourceType: "finding",
      factKind: "opened",
      effectiveAt: "2026-10-07T00:00:00Z",
      recordedAt: "2026-10-07T00:00:00Z",
      provenance: "source",
      href: `/vulnerabilities?findingId=${id}`,
    };
    read.mockResolvedValue({
      result: { items: [item], nextOffset: null, datasetRevision: "revision" },
      snapshot: pin,
    });
    const query = {
      datasetToken: initial.datasetToken,
      metric: "activity" as const,
      limit: 20,
    };
    const first = await api.sources(user, query);
    const repeated = await api.sources(user, query);
    const differentlySizedPage = await api.sources(user, {
      ...query,
      limit: 1,
    });
    expect(first.items[0]?.id).toMatch(/^source_[A-Za-z0-9_-]{43}$/);
    expect(first.items[0]?.id).not.toContain("918273645");
    expect(repeated.items[0]?.id).toBe(first.items[0]?.id);
    expect(differentlySizedPage.items[0]?.id).toBe(first.items[0]?.id);
    expect(first.items[0]).toEqual({ ...item, id: first.items[0]?.id });
    expect(item.id).toBe("finding-918273645-opened");
    expect(
      (await api.sources(user, { ...query, metric: "sbomCoverage" })).items[0]
        ?.id,
    ).not.toBe(first.items[0]?.id);
  });
  it("pins a parsed dataset and replays exact filters for CSV", async () => {
    const { api, read } = fixture();
    const result = await api.trends(user, filters);
    expect(result.datasetToken).toBeTruthy();
    expect(
      await api.export(user, { datasetToken: result.datasetToken }),
    ).toContain('"revision"');
    expect(
      (read.mock.calls.at(-1) as [string, { snapshot: unknown }])[1].snapshot,
    ).toEqual(pin);
  });
  it("rejects inactive, missing-session and revoked dashboard users before reads", async () => {
    const { api, read, snapshot } = fixture();
    await expect(
      api.trends({ ...user, isActive: false }, filters),
    ).rejects.toBeInstanceOf(DashboardForbiddenError);
    await expect(
      api.trends({ ...user, sessionId: undefined }, filters),
    ).rejects.toBeInstanceOf(DashboardForbiddenError);
    snapshot.mockResolvedValue({
      version: 1,
      permissions: {
        ...DEFAULT_PERMISSIONS_BY_ROLE.owner,
        can_view_dashboards: false,
      },
    });
    await expect(api.trends(user, filters)).rejects.toBeInstanceOf(
      DashboardForbiddenError,
    );
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects permission, tenant, session, and filter changes", async () => {
    const { api, snapshot } = fixture();
    const result = await api.trends(user, filters);
    await expect(
      api.trends(user, {
        ...filters,
        to: "2026-10-09",
        datasetToken: result.datasetToken,
      }),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
    await expect(
      api.trends(
        { ...user, organizationId: "different" },
        { ...filters, datasetToken: result.datasetToken },
      ),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
    snapshot.mockResolvedValue({
      version: 2,
      permissions: DEFAULT_PERMISSIONS_BY_ROLE.owner,
    });
    await expect(
      api.export(user, { datasetToken: result.datasetToken }),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
  });
  it("sanitizes permission and provider contract failures", async () => {
    const { api, snapshot, read } = fixture();
    snapshot.mockRejectedValueOnce(new Error("private"));
    await expect(api.trends(user, filters)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
    snapshot.mockResolvedValueOnce({
      version: 0,
      permissions: DEFAULT_PERMISSIONS_BY_ROLE.owner,
    });
    await expect(api.trends(user, filters)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
    read.mockResolvedValueOnce({
      result: { ...data(), organizationId: "other" },
      snapshot: pin,
    });
    await expect(api.trends(user, filters)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
  });
  it("rejects leaking withheld sections and blended duration cohorts", async () => {
    const { api, snapshot, read } = fixture();
    snapshot.mockResolvedValue({
      version: 1,
      permissions: {
        ...DEFAULT_PERMISSIONS_BY_ROLE.owner,
        can_view_findings: false,
      },
    });
    await expect(api.trends(user, filters)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
    snapshot.mockResolvedValue({
      version: 1,
      permissions: DEFAULT_PERMISSIONS_BY_ROLE.owner,
    });
    read.mockResolvedValue({
      result: {
        ...data(),
        series: {
          ...data().series,
          triage: { ...series("hours"), state: "available" },
        },
      },
      snapshot: pin,
    });
    await expect(api.trends(user, filters)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
  });
  it("pages sources bound to metric and original dataset", async () => {
    const { api, read } = fixture();
    const result = await api.trends(user, filters);
    read.mockResolvedValue({
      result: {
        items: [
          {
            id: "fact",
            productId: id,
            sourceId: id,
            sourceType: "finding",
            factKind: "opened",
            effectiveAt: "2026-10-08T00:00:00Z",
            recordedAt: "2026-10-08T00:00:00Z",
            provenance: "source",
            href: null,
          },
        ],
        nextOffset: 1,
        datasetRevision: "revision",
      },
      snapshot: pin,
    });
    const query = {
      datasetToken: result.datasetToken,
      metric: "activity" as const,
      limit: 20,
    };
    const first = await api.sources(user, query);
    read.mockResolvedValue({
      result: { items: [], nextOffset: null, datasetRevision: "revision" },
      snapshot: pin,
    });
    await api.sources(user, { ...query, cursor: first.nextCursor! });
    expect(
      (read.mock.calls.at(-1) as [string, { filters: { offset: number } }])[1]
        .filters.offset,
    ).toBe(1);
    await expect(
      api.sources(user, {
        ...query,
        metric: "sbomCoverage",
        cursor: first.nextCursor!,
      }),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
    read.mockResolvedValue({
      result: { items: [], nextOffset: null, datasetRevision: "revision" },
      snapshot: pin,
    });
    expect((await api.sources(user, query)).nextCursor).toBeNull();
    read.mockResolvedValue({ result: { invalid: true }, snapshot: pin });
    await expect(api.sources(user, query)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
  });
  it("rejects stale revisions and impossible pinned observation times", async () => {
    const { api, read } = fixture();
    const initial = await api.trends(user, filters);
    read.mockResolvedValueOnce({
      result: { ...data(), datasetRevision: "other" },
      snapshot: pin,
    });
    await expect(
      api.trends(user, { ...filters, datasetToken: initial.datasetToken }),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
    read.mockResolvedValueOnce({
      result: { ...data(), generatedAt: "2026-10-08T01:00:00Z" },
      snapshot: pin,
    });
    await expect(api.trends(user, filters)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
    read.mockResolvedValueOnce({
      result: {
        ...data(),
        series: {
          ...data().series,
          activity: {
            state: "available",
            reason: null,
            unit: "count",
            baselineAt: null,
            buckets: [
              {
                start: "2026-10-07T00:00:00Z",
                end: "2026-10-08T01:00:00Z",
                partial: true,
                opened: 0,
                closed: 0,
                reopened: 0,
                value: null,
                sampleCount: 0,
                excludedCount: 0,
                numerator: null,
                denominator: null,
                sourceCount: 0,
              },
            ],
          },
        },
      },
      snapshot: pin,
    });
    await expect(api.trends(user, filters)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
  });
  it("rejects source authorization and no-product duration requests before reads", async () => {
    const { api, read } = fixture();
    const initial = await api.trends(user, filters);
    read.mockClear();
    await expect(
      api.sources(user, {
        datasetToken: initial.datasetToken,
        metric: "triage",
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(DashboardForbiddenError);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects sources crossing selected product or revision boundaries", async () => {
    const { api, read } = fixture();
    const selected = { ...filters, productId: id };
    read.mockResolvedValueOnce({
      result: { ...data(), filters: selected },
      snapshot: pin,
    });
    const initial = await api.trends(user, selected);
    read.mockResolvedValueOnce({
      result: { items: [], nextOffset: null, datasetRevision: "changed" },
      snapshot: pin,
    });
    await expect(
      api.sources(user, {
        datasetToken: initial.datasetToken,
        metric: "activity",
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
    read.mockResolvedValueOnce({
      result: {
        items: [
          {
            id: "fact",
            productId: "00000000-0000-4000-8000-000000000002",
            sourceId: id,
            sourceType: "finding",
            factKind: "opened",
            effectiveAt: "2026-10-07T00:00:00Z",
            recordedAt: "2026-10-07T00:00:00Z",
            provenance: "source",
            href: null,
          },
        ],
        nextOffset: null,
        datasetRevision: "revision",
      },
      snapshot: pin,
    });
    await expect(
      api.sources(user, {
        datasetToken: initial.datasetToken,
        metric: "activity",
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(DashboardUnavailableError);
  });
  it("requires explicit refresh for validated changed pins while malformed provider data stays unavailable", async () => {
    const { api, read } = fixture();
    const initial = await api.trends(user, filters);
    const changedPin = { ...pin, maxFindingSequence: "2" };
    read.mockResolvedValueOnce({ result: data(), snapshot: changedPin });
    await expect(
      api.trends(user, { ...filters, datasetToken: initial.datasetToken }),
    ).rejects.toBeInstanceOf(DashboardDatasetConflictError);
    const sourcesQuery = {
      datasetToken: initial.datasetToken,
      metric: "activity" as const,
      limit: 20,
    };
    read.mockResolvedValueOnce({
      result: { items: [], nextOffset: null, datasetRevision: "revision" },
      snapshot: changedPin,
    });
    await expect(api.sources(user, sourcesQuery)).rejects.toBeInstanceOf(
      DashboardDatasetConflictError,
    );
    read.mockResolvedValueOnce({
      result: {
        ...data(),
        organizationId: "different",
        datasetRevision: "changed",
      },
      snapshot: changedPin,
    });
    await expect(
      api.trends(user, { ...filters, datasetToken: initial.datasetToken }),
    ).rejects.toBeInstanceOf(DashboardUnavailableError);
    read.mockResolvedValueOnce({
      result: {
        items: [{ invalid: true }],
        nextOffset: null,
        datasetRevision: "changed",
      },
      snapshot: changedPin,
    });
    await expect(api.sources(user, sourcesQuery)).rejects.toBeInstanceOf(
      DashboardUnavailableError,
    );
  });
});
