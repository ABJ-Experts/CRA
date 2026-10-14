import { DiagnosticPreviewTokens } from "./diagnostic-preview-tokens";
const selection = {
  categories: ["logs" as const],
  from: "2026-10-13T00:00:00.000Z",
  to: "2026-10-14T00:00:00.000Z",
};
const authority = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  authRevision: "4",
};
describe("diagnostic preview consent tokens", () => {
  it("binds purpose, authority and exact selection and expires in ten minutes", () => {
    let now = Date.parse(selection.to);
    const tokens = new DiagnosticPreviewTokens("x".repeat(32), () => now);
    const issued = tokens.mint({ ...authority, selection });
    expect(tokens.verify(issued.previewToken, authority)).toEqual(selection);
    for (const key of Object.keys(authority))
      expect(() =>
        tokens.verify(issued.previewToken, { ...authority, [key]: "changed" }),
      ).toThrow("access_changed");
    expect(() => tokens.verify(issued.previewToken + "x", authority)).toThrow();
    now += 600_000;
    expect(() => tokens.verify(issued.previewToken, authority)).toThrow(
      "preview_expired",
    );
  });
  it("rejects weak signing keys and malformed tokens", () => {
    expect(() => new DiagnosticPreviewTokens("weak")).toThrow();
    const tokens = new DiagnosticPreviewTokens("x".repeat(32));
    for (const value of ["", "x.y", "a.b.c", "x".repeat(10000)])
      expect(() => tokens.verify(value, authority)).toThrow();
  });
});

it("derives replay-stable purpose-separated grants bound to session and job", () => {
  const tokens = new DiagnosticPreviewTokens("x".repeat(32));
  const jobId = authority.actorId,
    key = authority.sessionId;
  const result = tokens.deriveGrant(authority, jobId, key);
  expect(result).toEqual(tokens.deriveGrant(authority, jobId, key));
  expect(result.grantId).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  expect(result.cookieValue).toMatch(/^[a-f0-9]{64}$/);
  expect(
    tokens.deriveGrant(
      { ...authority, sessionId: authority.actorId },
      jobId,
      key,
    ),
  ).not.toEqual(result);
  expect(tokens.deriveGrant(authority, authority.sessionId, key)).not.toEqual(
    result,
  );
});
