import { createHash } from "node:crypto";
import { AuditChainVerifier } from "./audit-chain-verifier";
import type { AuditChainPort } from "./audit-chain.port";

const organizationId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const genesis = "0".repeat(64);
const canonical = '{"number":9007199254740993,"unicode":"é"}';
const hash = createHash("sha256")
  .update(Buffer.from(genesis, "hex"))
  .update(canonical, "utf8")
  .digest("hex");
const row = {
  id: eventId,
  chain_version: 1,
  chain_sequence: "1",
  previous_hash: genesis,
  content_hash: hash,
  canonical_content: canonical,
  recomputed_canonical_content: canonical,
};
const head = {
  organization_id: organizationId,
  protected_through: null,
  required_retention_days: 0,
  retention_status: "unknown" as const,
  retention_checked_at: null,
  legal_hold: false,
  chain_version: 1,
  activation_at: "2026-10-06T00:00:00Z",
  legacy_count: "3",
  last_sequence: "1",
  last_event_id: eventId,
  last_hash: hash,
};
function port(rows = [row]): AuditChainPort {
  return {
    snapshot: jest.fn().mockResolvedValue(head),
    page: jest.fn().mockResolvedValue(rows),
  };
}
describe("AuditChainVerifier", () => {
  it("verifies exact UTF-8 bytes without coercing large JSON numbers", async () => {
    const result = await new AuditChainVerifier(port()).verify({
      organizationId,
    });
    expect(result).toMatchObject({
      status: "verified",
      verifiedCount: "1",
      legacyCount: "3",
      checkpointHash: hash,
    });
    expect(JSON.stringify(result)).not.toContain(canonical);
  });
  it.each([
    ["canonical_mismatch", { recomputed_canonical_content: "{}" }],
    ["unsupported_version", { chain_version: 2 }],
    ["hash_mismatch", { content_hash: genesis }],
    ["previous_hash_mismatch", { previous_hash: hash }],
    ["sequence_gap", { chain_sequence: "2" }],
  ])("detects %s", async (reason, change) => {
    expect(
      await new AuditChainVerifier(port([{ ...row, ...change }])).verify({
        organizationId,
      }),
    ).toMatchObject({ status: "corrupt", reason });
  });
  it("rejects missing rows", async () => {
    expect(
      await new AuditChainVerifier(port([])).verify({ organizationId }),
    ).toMatchObject({ status: "corrupt", reason: "sequence_gap" });
  });
  it("detects head corruption", async () => {
    const source = port();
    source.snapshot = jest
      .fn()
      .mockResolvedValue({ ...head, last_hash: genesis });
    expect(
      await new AuditChainVerifier(source).verify({ organizationId }),
    ).toMatchObject({ status: "corrupt", reason: "head_mismatch" });
  });
  it("reports safe incomplete results on adapter failure", async () => {
    const source = port();
    source.page = jest.fn().mockRejectedValue(new Error("secret"));
    const result = await new AuditChainVerifier(source).verify({
      organizationId,
    });
    expect(result).toMatchObject({
      status: "incomplete",
      reason: "read_failed",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("bounds work and validates before reads", async () => {
    const snapshot = jest.fn().mockResolvedValue(head);
    const source = { ...port(), snapshot };
    await expect(
      new AuditChainVerifier(source).verify({ organizationId: "forged" }),
    ).rejects.toThrow();
    expect(snapshot).not.toHaveBeenCalled();
    expect(
      await new AuditChainVerifier(source).verify({
        organizationId,
        toSequence: "2",
      }),
    ).toMatchObject({ status: "incomplete", reason: "range_unavailable" });
  });
  it("verifies a partial range using its predecessor without claiming full-chain coverage", async () => {
    const secondCanonical = "{}";
    const secondHash = createHash("sha256")
      .update(Buffer.from(hash, "hex"))
      .update(secondCanonical)
      .digest("hex");
    const second = {
      ...row,
      id: organizationId,
      chain_sequence: "2",
      previous_hash: hash,
      content_hash: secondHash,
      canonical_content: secondCanonical,
      recomputed_canonical_content: secondCanonical,
    };
    const source: AuditChainPort = {
      snapshot: jest.fn().mockResolvedValue({
        ...head,
        last_sequence: "2",
        last_hash: secondHash,
        last_event_id: organizationId,
      }),
      page: jest
        .fn()
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([second]),
    };
    expect(
      await new AuditChainVerifier(source).verify({
        organizationId,
        fromSequence: "2",
      }),
    ).toMatchObject({
      status: "verified",
      fullChain: false,
      verifiedCount: "1",
      checkpointHash: secondHash,
    });
  });
  it("fails a partial range with a missing predecessor", async () => {
    const source = port([]);
    source.snapshot = jest
      .fn()
      .mockResolvedValue({ ...head, last_sequence: "2" });
    expect(
      await new AuditChainVerifier(source).verify({
        organizationId,
        fromSequence: "2",
      }),
    ).toMatchObject({ reason: "sequence_gap" });
  });
  it("limits events without silently claiming verification", async () => {
    const source = port();
    source.snapshot = jest
      .fn()
      .mockResolvedValue({ ...head, last_sequence: "2" });
    expect(
      await new AuditChainVerifier(source).verify({
        organizationId,
        maxEvents: 1,
      }),
    ).toMatchObject({
      status: "incomplete",
      reason: "event_limit",
      verifiedCount: "1",
    });
  });
  it("verifies an empty activated chain", async () => {
    const source = port([]);
    source.snapshot = jest.fn().mockResolvedValue({
      ...head,
      last_sequence: "0",
      last_event_id: null,
      last_hash: genesis,
    });
    expect(
      await new AuditChainVerifier(source).verify({ organizationId }),
    ).toMatchObject({
      status: "verified",
      verifiedCount: "0",
      fullChain: true,
    });
  });
  it("rejects foreign head identity", async () => {
    const source = port();
    source.snapshot = jest
      .fn()
      .mockResolvedValue({ ...head, organization_id: eventId });
    expect(
      await new AuditChainVerifier(source).verify({ organizationId }),
    ).toMatchObject({ reason: "head_mismatch" });
  });
  it.each([
    { reason: "unsupported_version", change: { chain_version: 2 } },
    {
      reason: "canonical_mismatch",
      change: { recomputed_canonical_content: "altered" },
    },
    { reason: "hash_mismatch", change: { content_hash: genesis } },
  ])("validates range predecessor: $reason", async ({ reason, change }) => {
    const source = port([{ ...row, ...change }]);
    source.snapshot = jest
      .fn()
      .mockResolvedValue({ ...head, last_sequence: "2" });
    expect(
      await new AuditChainVerifier(source).verify({
        organizationId,
        fromSequence: "2",
      }),
    ).toMatchObject({ reason });
  });
  it.each([
    { checked: null, expected: "unknown" },
    {
      checked: new Date(Date.now() - 86400001).toISOString(),
      expected: "unknown",
    },
    {
      checked: new Date(Date.now() - 1000).toISOString(),
      expected: "protected",
    },
    {
      checked: new Date(Date.now() + 86400000).toISOString(),
      expected: "unknown",
    },
  ])(
    "reports retention conservatively for $checked",
    async ({ checked, expected }) => {
      const source = port();
      source.snapshot = jest.fn().mockResolvedValue({
        ...head,
        retention_checked_at: checked,
        retention_status: "protected",
        legal_hold: true,
        required_retention_days: 3650,
      });
      expect(
        await new AuditChainVerifier(source).verify({ organizationId }),
      ).toMatchObject({
        status: "verified",
        archivalRequired: true,
        retention: {
          retention_status: expected,
          legal_hold: true,
          required_retention_days: 3650,
        },
      });
    },
  );
  it("rejects an unsupported empty chain version", async () => {
    const source = port();
    source.snapshot = jest
      .fn()
      .mockResolvedValue({ ...head, chain_version: 2 });
    expect(
      await new AuditChainVerifier(source).verify({ organizationId }),
    ).toMatchObject({ reason: "unsupported_version" });
  });
});
