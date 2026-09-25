// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { deriveConnectorCardStatus } from "./connector-status";
import type { Connector } from "../../_features/connectors/connectors.schemas";

const now = new Date("2026-08-19T00:00:00.000Z").getTime();

function baseConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    connectorType: "reference_conformance",
    displayName: "Reference PLM",
    adapterVersion: "1.0.0",
    mappingVersion: "1.0.0",
    connectionConfig: {},
    hasSecret: false,
    commitPolicy: "manual",
    enabled: true,
    lastTestedAt: null,
    lastTestOutcome: null,
    lastTestErrorCode: null,
    archivedAt: null,
    version: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: "33333333-3333-4333-8333-333333333333",
    updatedAt: "2026-08-01T00:00:00.000Z",
    updatedBy: "33333333-3333-4333-8333-333333333333",
    ...overrides,
  };
}

describe("deriveConnectorCardStatus", () => {
  it("is disconnected when disabled, regardless of other signals", () => {
    expect(
      deriveConnectorCardStatus(
        baseConnector({ enabled: false, activeSyncRunStatus: "running" }),
        now,
      ),
    ).toBe("disconnected");
  });

  it("is unauthorized on an auth-flavoured failed test", () => {
    expect(
      deriveConnectorCardStatus(
        baseConnector({
          lastTestOutcome: "failure",
          lastTestErrorCode: "auth_failed",
        }),
        now,
      ),
    ).toBe("unauthorized");
  });

  it("is failed when the active sync run failed", () => {
    expect(
      deriveConnectorCardStatus(
        baseConnector({ activeSyncRunStatus: "failed" }),
        now,
      ),
    ).toBe("failed");
  });

  it("is partial-provider-outage when the circuit is open", () => {
    expect(
      deriveConnectorCardStatus(baseConnector({ circuitState: "open" }), now),
    ).toBe("partial-provider-outage");
  });

  it("is rate-limited on a rate-limit-flavoured failed test", () => {
    expect(
      deriveConnectorCardStatus(
        baseConnector({
          lastTestOutcome: "failure",
          lastTestErrorCode: "rate_limited",
        }),
        now,
      ),
    ).toBe("rate-limited");
  });

  it("is retrying when the active sync run is retrying", () => {
    expect(
      deriveConnectorCardStatus(
        baseConnector({ activeSyncRunStatus: "retrying" }),
        now,
      ),
    ).toBe("retrying");
  });

  it("is syncing while the active sync run is queued, running, or waiting for review", () => {
    for (const status of ["queued", "running", "waiting_for_review"] as const) {
      expect(
        deriveConnectorCardStatus(
          baseConnector({ activeSyncRunStatus: status }),
          now,
        ),
      ).toBe("syncing");
    }
  });

  it("is stale when the last committed sync is older than the freshness window", () => {
    expect(
      deriveConnectorCardStatus(
        baseConnector({ lastCommittedAt: "2026-08-01T00:00:00.000Z" }),
        now,
      ),
    ).toBe("stale");
  });

  it("is connected when enabled, tested successfully, and recently committed", () => {
    expect(
      deriveConnectorCardStatus(
        baseConnector({
          lastTestOutcome: "success",
          lastCommittedAt: "2026-08-18T23:00:00.000Z",
        }),
        now,
      ),
    ).toBe("connected");
  });
});
