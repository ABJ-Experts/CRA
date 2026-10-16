import type { ConfigService } from "@nestjs/config";

import { AuditExplorerTokenService } from "./audit-explorer-token.service";

const principal = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  actorId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
};

const filters = {
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-01-02T00:00:00.000Z",
};

function service(): AuditExplorerTokenService {
  return new AuditExplorerTokenService({
    getOrThrow: (key: string) => {
      if (key !== "COOKIE_SIGNING_SECRET") throw new Error(key);
      return "test-cookie-secret-with-enough-entropy";
    },
  } as unknown as ConfigService);
}

describe("AuditExplorerTokenService", () => {
  it("round-trips a snapshot token for the same verified principal", () => {
    const tokens = service();
    const token = tokens.snapshot({
      kind: "snapshot",
      ...principal,
      requestId: "44444444-4444-4444-8444-444444444444",
      receiptId: "55555555-5555-4555-8555-555555555555",
      highWaterSequence: "42",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      filterDigest: "a".repeat(64),
      scopeDigest: "b".repeat(64),
      scopeVersion: "7",
      filters,
    });

    expect(tokens.openSnapshot(token, principal).highWaterSequence).toBe("42");
  });

  it("rejects a token replayed across sessions", () => {
    const tokens = service();
    const token = tokens.downloadGrant({
      kind: "download",
      ...principal,
      requestId: "44444444-4444-4444-8444-444444444444",
      jobId: "66666666-6666-4666-8666-666666666666",
      packageHash: "c".repeat(64),
      permissionFingerprint: "d".repeat(64),
      randomDigest: "e".repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(() =>
      tokens.openDownloadGrant(token, {
        ...principal,
        sessionId: "77777777-7777-4777-8777-777777777777",
      }),
    ).toThrow("token principal mismatch");
  });

  it("rejects tampered ciphertext", () => {
    const tokens = service();
    const token = tokens.cursor({
      kind: "cursor",
      ...principal,
      requestId: "44444444-4444-4444-8444-444444444444",
      receiptId: "55555555-5555-4555-8555-555555555555",
      afterSequence: "1",
      afterCreatedAt: null,
      afterId: "88888888-8888-4888-8888-888888888888",
    });

    const [version, iv, encrypted, tag] = token.split(".");
    const replacement = encrypted?.[0] === "A" ? "B" : "A";
    const tampered = [
      version,
      iv,
      `${replacement}${encrypted?.slice(1)}`,
      tag,
    ].join(".");

    expect(() => tokens.openCursor(tampered, principal)).toThrow();
  });
});

describe("AuditExplorerTokenService invalid envelopes", () => {
  it("rejects malformed envelopes and expired payloads", () => {
    const tokens = service();
    expect(() => tokens.openSnapshot("v1.only.two", principal)).toThrow(
      "invalid token envelope",
    );
    const expired = tokens.snapshot({
      kind: "snapshot",
      ...principal,
      requestId: "44444444-4444-4444-8444-444444444444",
      receiptId: "55555555-5555-4555-8555-555555555555",
      highWaterSequence: "42",
      expiresAt: "2020-01-01T00:00:00.000Z",
      filterDigest: "a".repeat(64),
      scopeDigest: "b".repeat(64),
      scopeVersion: "7",
      filters,
    });
    expect(() => tokens.openSnapshot(expired, principal)).toThrow(
      "token expired",
    );
  });
});
