import { describe, expect, it } from "vitest";
import {
  agentFrameBodySchema,
  agentFrameResponseSchema,
  agentStatusResponseSchema,
  issueAgentEnrollmentInputSchema,
  onPremAgentConnectorConfigurationSchema,
} from "./index.js";

const identity = {
  version: 1,
  organizationId: "d6fe0748-1347-4e86-b83d-9b411028ae5e",
  connectorId: "5c121ec3-2608-4b77-978d-c62d05360634",
  agentId: "e00dd69c-9906-481b-ab49-56a76fdf9ad2",
} as const;

describe("on-prem agent wire contracts", () => {
  it("accepts only empty server-side connection configuration", () => {
    expect(onPremAgentConnectorConfigurationSchema.parse({})).toEqual({});
    expect(onPremAgentConnectorConfigurationSchema.safeParse({ token: "secret" }).success).toBe(false);
  });

  it("requires a real enrollment idempotency key", () => {
    expect(issueAgentEnrollmentInputSchema.safeParse({ idempotencyKey: "no" }).success).toBe(false);
  });

  it("parses a bounded canonical batch and rejects unknown fields", () => {
    const body = {
      ...identity,
      kind: "batch",
      batchId: "07967063-44e2-40fa-b195-3df08aa51fce",
      sequence: 1,
      sourceId: "local-products",
      cursorFrom: null,
      cursorTo: "1",
      records: [],
      backlogCount: 0,
      backlogBytes: 0,
    };
    expect(agentFrameBodySchema.safeParse(body).success).toBe(true);
    expect(agentFrameBodySchema.safeParse({ ...body, command: "rm -rf /" }).success).toBe(false);
    expect(agentFrameBodySchema.safeParse({ ...body, records: Array(201).fill({}) }).success).toBe(false);
  });

  it("parses exact ACK and redacted management status", () => {
    expect(agentFrameResponseSchema.safeParse({
      kind: "batch", batchId: "07967063-44e2-40fa-b195-3df08aa51fce",
      sequence: 1, acceptedAt: "2026-10-01T00:00:00.000Z",
    }).success).toBe(true);
    expect(agentStatusResponseSchema.safeParse({
      agent: null, batches: { rows: [], nextCursor: null },
    }).success).toBe(true);
    expect(agentFrameBodySchema.safeParse({
      ...identity, kind: "heartbeat", agentVersion: "1.0.0",
      capabilities: ["canonical_file"], backlogCount: 1,
      backlogBytes: 128, safeErrorCode: "backpressure",
    }).success).toBe(true);
    expect(agentFrameBodySchema.safeParse({
      ...identity, kind: "heartbeat", agentVersion: "1.0.0",
      capabilities: ["canonical_file"], backlogCount: 1,
      backlogBytes: 128, safeErrorCode: "rotation_in_progress",
    }).success).toBe(true);
  });
});
