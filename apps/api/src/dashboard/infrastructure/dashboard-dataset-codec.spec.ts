import { DashboardDatasetCodec } from "./dashboard-dataset-codec";
import { DashboardDatasetConflictError } from "../application/dashboard-trends.port";
const scope = {
  organizationId: "org",
  actorId: "actor",
  sessionId: "session",
  permissionFingerprint: "permissions",
  endpoint: "trends",
  filters: {},
};
describe("dataset tokens", () => {
  it("keys source identifiers to scope and pinned dataset with a separate secret purpose", () => {
    const codec = new DashboardDatasetCodec("secret");
    const dataset = { pin: "snapshot", datasetRevision: "revision" };
    const rawId = "coverage-918273645-observation";
    const opaque = codec.opaqueSourceId(scope, dataset, rawId);
    expect(opaque).toMatch(/^source_[A-Za-z0-9_-]{43}$/);
    expect(opaque).not.toContain("918273645");
    expect(codec.opaqueSourceId(scope, dataset, rawId)).toBe(opaque);
    expect(
      codec.opaqueSourceId(
        scope,
        { datasetRevision: "revision", pin: "snapshot" },
        rawId,
      ),
    ).toBe(opaque);
    for (const changedScope of [
      { ...scope, organizationId: "other" },
      { ...scope, actorId: "other" },
      { ...scope, sessionId: "other" },
      { ...scope, permissionFingerprint: "other" },
      { ...scope, filters: { productId: "other" } },
    ])
      expect(codec.opaqueSourceId(changedScope, dataset, rawId)).not.toBe(
        opaque,
      );
    expect(
      codec.opaqueSourceId(scope, { ...dataset, pin: "other" }, rawId),
    ).not.toBe(opaque);
    expect(
      codec.opaqueSourceId(scope, dataset, "coverage-918273646-observation"),
    ).not.toBe(opaque);
    expect(
      new DashboardDatasetCodec("other secret").opaqueSourceId(
        scope,
        dataset,
        rawId,
      ),
    ).not.toBe(opaque);
    expect(opaque).not.toBe(
      `source_${codec.fingerprint({ scope, dataset, rawId })}`,
    );
  });
  it("pins large PostgreSQL snapshots without changing cursor limits", () => {
    const c = new DashboardDatasetCodec("secret");
    const value = { snapshot: "1:" + "3,".repeat(2000) };
    expect(c.open(c.seal(scope, value), scope)).toEqual(value);
  });
  it("rejects tampering, expiry, changed scope and oversized pins", () => {
    const c = new DashboardDatasetCodec("secret");
    const t = c.seal(scope, { snapshot: "1:2:" });
    expect(() =>
      c.open(t, { ...scope, permissionFingerprint: "changed" }),
    ).toThrow(DashboardDatasetConflictError);
    expect(() => c.open(t + "x", scope)).toThrow(DashboardDatasetConflictError);
    expect(() => c.open(c.seal(scope, {}, 0), scope)).toThrow(
      DashboardDatasetConflictError,
    );
    expect(() => c.seal(scope, { snapshot: "x".repeat(20000) })).toThrow();
  });
});
