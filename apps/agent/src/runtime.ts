import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { agentFrameBodySchema, agentFrameResponseSchema } from "@repo/contracts/connectors/schemas";
import type { z } from "zod";
import type { AgentConfig } from "./config.js";
import { readProtectedText } from "./config.js";
import type { AgentQueue } from "./queue.js";
import { readCanonicalFilePage, readCanonicalHttpsPage } from "./sources.js";
import type { AgentCredentials } from "./transport.js";

type BatchFrame = Extract<z.output<typeof agentFrameBodySchema>, { kind: "batch" }>;
type BatchAck = Extract<z.output<typeof agentFrameResponseSchema>, { kind: "batch" }>;
type Source = AgentConfig["sources"][number];
type Limits = Pick<AgentConfig, "maxRecords" | "maxReadBytes" | "timeoutMs">;

export async function processSource(
  config: Limits,
  source: Source,
  queue: AgentQueue,
  credentials: AgentCredentials,
  send: (frame: BatchFrame) => Promise<BatchAck>,
): Promise<void> {
  const pending = queue.pending(source.id);
  if (pending) {
    const frame = agentFrameBodySchema.parse(JSON.parse(pending.body) as unknown);
    if (frame.kind !== "batch" || frame.batchId !== pending.batchId || frame.sequence !== pending.sequence) throw new Error("queue_frame_corrupt");
    const ack = await send(frame);
    if (ack.kind !== "batch" || ack.batchId !== pending.batchId || ack.sequence !== pending.sequence) throw new Error("ack_mismatch");
    queue.ack(ack.batchId, ack.sequence);
    return;
  }

  const cursorFrom = queue.checkpoint(source.id);
  const page = source.type === "file"
    ? await readCanonicalFilePage(source.path, cursorFrom, config.maxRecords, config.maxReadBytes)
    : await readCanonicalHttpsPage({
        url: source.url,
        allowedHost: source.allowedHost,
        allowedAddresses: source.allowedAddresses,
        ...(source.authorizationFile ? { authorization: readProtectedText(source.authorizationFile) } : {}),
        ...(source.caFile ? { caPem: readFileSync(source.caFile, "utf8") } : {}),
      }, cursorFrom, config.maxReadBytes, config.timeoutMs);
  if (page.records.length === 0) return;
  if (page.nextCursor === null || page.nextCursor === cursorFrom) throw new Error("invalid_source_cursor");
  const backlog = queue.backlog();
  const frame = agentFrameBodySchema.parse({
    version: 1,
    kind: "batch",
    organizationId: credentials.organizationId,
    connectorId: credentials.connectorId,
    agentId: credentials.agentId,
    batchId: randomUUID(),
    sequence: queue.nextSequence(source.id),
    sourceId: source.id,
    cursorFrom,
    cursorTo: page.nextCursor,
    records: page.records,
    backlogCount: backlog.count + 1,
    backlogBytes: backlog.bytes + Buffer.byteLength(JSON.stringify(page.records)),
  });
  if (frame.kind !== "batch") throw new Error("invalid_batch_frame");
  const body = JSON.stringify(frame);
  if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error("frame_too_large");
  queue.enqueue({ sourceId: source.id, batchId: frame.batchId, sequence: frame.sequence, cursorFrom, cursorTo: page.nextCursor, body });
  const ack = await send(frame);
  if (ack.kind !== "batch" || ack.batchId !== frame.batchId || ack.sequence !== frame.sequence) throw new Error("ack_mismatch");
  queue.ack(ack.batchId, ack.sequence);
}

export function safeErrorCode(error: unknown): "source_unavailable" | "source_changed" | "source_invalid" | "queue_full" | "backpressure" | "network_unavailable" | "proxy_failed" | "tls_failed" | "clock_skew" | "rotation_in_progress" | "credential_expired" | "unknown" {
  const message = error instanceof Error ? error.message : "unknown";
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "";
  if (["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN"].includes(code)) return "tls_failed";
  if (["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET"].includes(code)) return "network_unavailable";
  if (message === "queue_full" || message === "pending_batch") return "queue_full";
  if (message === "backpressure") return "backpressure";
  if (message === "source_replaced" || message === "source_truncated") return "source_changed";
  if (message === "source_unavailable" || message === "source_http_error" || message === "source_timeout") return "source_unavailable";
  if (message.startsWith("source_") || message === "invalid_source_cursor") return "source_invalid";
  if (message.includes("proxy")) return "proxy_failed";
  if (message.includes("certificate") || message.includes("tls")) return "tls_failed";
  if (message === "clock_skew") return "clock_skew";
  if (message === "rotation_in_progress") return "rotation_in_progress";
  if (message === "key_rotation_required" || message === "revoked") return "credential_expired";
  if (message.includes("network") || message.includes("timeout") || message === "offline") return "network_unavailable";
  return "unknown";
}
