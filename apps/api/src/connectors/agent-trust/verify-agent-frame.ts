import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Implements the trust model in docs/architecture/adrs/ADR-0002-connector-agent-trust-model.md.
 * This IS the production verifier -- the loopback test double drives this
 * exact function, not a re-implementation, so there is no separate "prod"
 * path to drift from the ADR once a real ingress exists.
 */

const CLOCK_SKEW_SECONDS = 120;
const MAX_KEY_AGE_DAYS = 90;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type AgentIdentity = Readonly<{
  agentId: string;
  organizationId: string;
  connectorId: string;
  signingKey: string;
  signingKeyIssuedAt: string; // ISO-8601
  revoked: boolean;
}>;

export type AgentFrame = Readonly<{
  timestamp: string; // ISO-8601
  nonce: string;
  method: string;
  path: string;
  body: string; // raw request body, already read
  contentType: string;
  signature: string; // hex HMAC-SHA256
  targetOrganizationId: string;
  targetConnectorId: string;
}>;

export type AgentDirectory = Readonly<{
  findByAgentId(agentId: string): Promise<AgentIdentity | null>;
}>;

export type NonceCache = Readonly<{
  /** Returns true if (agentId, nonce) was already seen within the skew window. */
  seen(agentId: string, nonce: string): Promise<boolean>;
  record(agentId: string, nonce: string): Promise<void>;
}>;

export type VerifyAgentFrameResult =
  | Readonly<{ outcome: "accepted"; agentId: string }>
  | Readonly<{
      outcome: "rejected";
      reason:
        | "unknown_agent"
        | "revoked"
        | "key_rotation_required"
        | "clock_skew"
        | "replay"
        | "org_mismatch"
        | "invalid_signature"
        | "payload_too_large"
        | "unsupported_content_type"
        | "malformed";
    }>;

export async function verifyAgentFrame(
  frame: AgentFrame,
  directory: AgentDirectory,
  nonces: NonceCache,
  agentId: string,
): Promise<VerifyAgentFrameResult> {
  // Cheapest, most attacker-controllable checks first -- never let an
  // oversized or wrongly-typed payload reach identity/signature logic.
  if (Buffer.byteLength(frame.body, "utf8") > MAX_BODY_BYTES) {
    return { outcome: "rejected", reason: "payload_too_large" };
  }
  if (frame.contentType !== "application/json") {
    return { outcome: "rejected", reason: "unsupported_content_type" };
  }
  try {
    JSON.parse(frame.body || "{}");
  } catch {
    return { outcome: "rejected", reason: "malformed" };
  }

  const identity = await directory.findByAgentId(agentId);
  if (!identity) return { outcome: "rejected", reason: "unknown_agent" };
  if (identity.revoked) return { outcome: "rejected", reason: "revoked" };

  const keyAgeDays =
    (Date.now() - Date.parse(identity.signingKeyIssuedAt)) /
    (1000 * 60 * 60 * 24);
  if (keyAgeDays > MAX_KEY_AGE_DAYS) {
    return { outcome: "rejected", reason: "key_rotation_required" };
  }

  const skewSeconds = Math.abs(
    (Date.now() - Date.parse(frame.timestamp)) / 1000,
  );
  if (!Number.isFinite(skewSeconds) || skewSeconds > CLOCK_SKEW_SECONDS) {
    return { outcome: "rejected", reason: "clock_skew" };
  }

  if (
    identity.organizationId !== frame.targetOrganizationId ||
    identity.connectorId !== frame.targetConnectorId
  ) {
    return { outcome: "rejected", reason: "org_mismatch" };
  }

  if (await nonces.seen(agentId, frame.nonce)) {
    return { outcome: "rejected", reason: "replay" };
  }

  const bodyHash = createHash("sha256").update(frame.body).digest("hex");
  const expectedSignature = createHmac("sha256", identity.signingKey)
    .update(
      `${frame.timestamp}.${frame.nonce}.${bodyHash}.${frame.method}.${frame.path}`,
    )
    .digest("hex");
  const provided = Buffer.from(frame.signature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return { outcome: "rejected", reason: "invalid_signature" };
  }

  await nonces.record(agentId, frame.nonce);
  return { outcome: "accepted", agentId };
}

export function signFrame(
  identity: Pick<AgentIdentity, "signingKey">,
  input: Pick<AgentFrame, "timestamp" | "nonce" | "body" | "method" | "path">,
): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  return createHmac("sha256", identity.signingKey)
    .update(
      `${input.timestamp}.${input.nonce}.${bodyHash}.${input.method}.${input.path}`,
    )
    .digest("hex");
}

/** In-memory nonce cache bounded by the clock-skew window -- sufficient for
 * the loopback double; a real ingress would back this with a shared store. */
export class InMemoryNonceCache implements NonceCache {
  private readonly seenAt = new Map<string, number>();

  seen(agentId: string, nonce: string): Promise<boolean> {
    this.prune();
    return Promise.resolve(this.seenAt.has(`${agentId}:${nonce}`));
  }

  record(agentId: string, nonce: string): Promise<void> {
    this.seenAt.set(`${agentId}:${nonce}`, Date.now());
    return Promise.resolve();
  }

  private prune(): void {
    const cutoff = Date.now() - CLOCK_SKEW_SECONDS * 1000 * 2;
    for (const [key, at] of this.seenAt)
      if (at < cutoff) this.seenAt.delete(key);
  }
}
