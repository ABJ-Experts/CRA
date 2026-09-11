import { randomUUID } from "node:crypto";

import {
  InMemoryNonceCache,
  signFrame,
  verifyAgentFrame,
  type AgentDirectory,
  type AgentFrame,
  type AgentIdentity,
} from "./verify-agent-frame";

/**
 * The local-loopback reference implementation from ADR-0002: drives the
 * literal production verifier end to end, proving the trust model without a
 * real network or a deployed agent.
 */
function loopbackDirectory(
  identities: readonly AgentIdentity[],
): AgentDirectory {
  return {
    findByAgentId(agentId) {
      return Promise.resolve(
        identities.find((identity) => identity.agentId === agentId) ?? null,
      );
    },
  };
}

function baseIdentity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    agentId: "agent-1",
    organizationId: "org-1",
    connectorId: "connector-1",
    signingKey: "test-signing-key-not-a-real-secret",
    signingKeyIssuedAt: new Date().toISOString(),
    revoked: false,
    ...overrides,
  };
}

function frameFor(
  identity: AgentIdentity,
  overrides: Partial<Omit<AgentFrame, "signature">> = {},
): AgentFrame {
  const body = overrides.body ?? JSON.stringify({ hello: "world" });
  const input = {
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    nonce: overrides.nonce ?? randomUUID(),
    method: overrides.method ?? "POST",
    path: overrides.path ?? "/agent/sync-batches",
    body,
  };
  return {
    ...input,
    contentType: overrides.contentType ?? "application/json",
    targetOrganizationId:
      overrides.targetOrganizationId ?? identity.organizationId,
    targetConnectorId: overrides.targetConnectorId ?? identity.connectorId,
    signature: signFrame(identity, input),
  };
}

describe("verifyAgentFrame (local-loopback proof of ADR-0002)", () => {
  it("accepts a correctly signed frame from an enrolled agent", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const result = await verifyAgentFrame(
      frameFor(identity),
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({ outcome: "accepted", agentId: identity.agentId });
  });

  it("rejects a replayed (agentId, nonce) pair", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const nonces = new InMemoryNonceCache();
    const frame = frameFor(identity);
    await verifyAgentFrame(frame, directory, nonces, identity.agentId);
    const replay = await verifyAgentFrame(
      frame,
      directory,
      nonces,
      identity.agentId,
    );
    expect(replay).toEqual({ outcome: "rejected", reason: "replay" });
  });

  it("rejects a frame signed with a revoked key", async () => {
    const identity = baseIdentity({ revoked: true });
    const directory = loopbackDirectory([identity]);
    const result = await verifyAgentFrame(
      frameFor(identity),
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({ outcome: "rejected", reason: "revoked" });
  });

  it("rejects a frame whose certificate org/connector does not match the target", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const frame = frameFor(identity, { targetOrganizationId: "org-2" });
    const result = await verifyAgentFrame(
      frame,
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({ outcome: "rejected", reason: "org_mismatch" });
  });

  it("rejects a frame outside the clock-skew window", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const frame = frameFor(identity, { timestamp: stale });
    const result = await verifyAgentFrame(
      frame,
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({ outcome: "rejected", reason: "clock_skew" });
  });

  it("rejects an over-age signing key requiring rotation", async () => {
    const identity = baseIdentity({
      signingKeyIssuedAt: new Date(
        Date.now() - 200 * 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
    const directory = loopbackDirectory([identity]);
    const result = await verifyAgentFrame(
      frameFor(identity),
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({
      outcome: "rejected",
      reason: "key_rotation_required",
    });
  });

  it("rejects an oversized payload before any signature/business logic runs", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const huge = "x".repeat(5 * 1024 * 1024);
    const frame = frameFor(identity, { body: huge });
    const result = await verifyAgentFrame(
      frame,
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({
      outcome: "rejected",
      reason: "payload_too_large",
    });
  });

  it("rejects a non-JSON content type before signature verification", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const frame = frameFor(identity, { contentType: "application/xml" });
    const result = await verifyAgentFrame(
      frame,
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({
      outcome: "rejected",
      reason: "unsupported_content_type",
    });
  });

  it("rejects malformed JSON before signature verification", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const frame = frameFor(identity, { body: "{not json" });
    const result = await verifyAgentFrame(
      frame,
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({ outcome: "rejected", reason: "malformed" });
  });

  it("rejects a forged signature (tampered body after signing)", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const frame = frameFor(identity);
    const tampered = { ...frame, body: JSON.stringify({ hello: "tampered" }) };
    const result = await verifyAgentFrame(
      tampered,
      directory,
      new InMemoryNonceCache(),
      identity.agentId,
    );
    expect(result).toEqual({
      outcome: "rejected",
      reason: "invalid_signature",
    });
  });

  it("rejects an unknown agent id", async () => {
    const identity = baseIdentity();
    const directory = loopbackDirectory([identity]);
    const result = await verifyAgentFrame(
      frameFor(identity),
      directory,
      new InMemoryNonceCache(),
      "not-enrolled",
    );
    expect(result).toEqual({ outcome: "rejected", reason: "unknown_agent" });
  });
});
