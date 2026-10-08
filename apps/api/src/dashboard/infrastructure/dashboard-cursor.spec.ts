import { DashboardCursorCodec } from "./dashboard-cursor";

describe("opaque dashboard cursors", () => {
  const scope = {
    organizationId: "org",
    actorId: "actor",
    sessionId: "session",
    permissionFingerprint: "revision",
    endpoint: "readiness",
    filters: { limit: 20 },
  };
  const codec = new DashboardCursorCodec("test-only-secret");
  it("round trips encrypted keysets, without exposing identifiers", () => {
    const token = codec.seal(scope, { id: "private-id" });
    expect(token).not.toContain("private-id");
    expect(codec.open(token, scope)).toEqual({ id: "private-id" });
  });
  it.each([
    "organizationId",
    "actorId",
    "sessionId",
    "permissionFingerprint",
    "endpoint",
    "filters",
  ])("rejects changed %s", (field) => {
    const token = codec.seal(scope, { id: "private-id" });
    expect(() =>
      codec.open(token, {
        ...scope,
        [field]: field === "filters" ? { limit: 100 } : "changed",
      }),
    ).toThrow("Invalid dashboard cursor");
  });
  it("rejects expiry, corruption, alternate secret, and oversized envelopes", () => {
    const token = codec.seal(scope, {}, 0);
    expect(() => codec.open(token, scope)).toThrow();
    expect(() => codec.open("bad", scope)).toThrow();
    expect(() =>
      new DashboardCursorCodec("other").open(codec.seal(scope, {}), scope),
    ).toThrow();
    expect(() => codec.open("x".repeat(9000), scope)).toThrow();
  });
  it("binds filters canonically", () => {
    const token = codec.seal({ ...scope, filters: { a: 1, b: 2 } }, {});
    expect(codec.open(token, { ...scope, filters: { b: 2, a: 1 } })).toEqual(
      {},
    );
  });
});
