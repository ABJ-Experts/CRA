import type { TagTone } from "@repo/ui/tag";

import type { Connector } from "../../_features/connectors/connectors.schemas";

/**
 * The 16 states this feature has to represent are spread across screens
 * (see the ticket's "Required states" table). This module only derives the
 * subset a connector *card* can show without an extra request per card:
 * disconnected, unauthorized, partial-provider-outage, rate-limited,
 * retrying, syncing, failed, stale, plus a default "connected" ok state.
 * `waiting-for-review`, `dry-run`, `conflicts-present`, `mapping-incomplete`,
 * `testing`, `canceled`, `completed`, and `forbidden` are all sync-run- or
 * permission-scoped and rendered on the detail page instead.
 */
export type ConnectorCardStatus =
  | "disconnected"
  | "unauthorized"
  | "partial-provider-outage"
  | "rate-limited"
  | "retrying"
  | "syncing"
  | "failed"
  | "stale"
  | "connected";

// Codes come from `@repo/contracts/connectors`' `connectorErrorCodeSchema`.
const UNAUTHORIZED_ERROR_CODES = new Set(["auth_failed"]);
const RATE_LIMITED_ERROR_CODES = new Set(["rate_limited"]);

// ponytail: naive fixed threshold. Upgrade to a per-connector configured
// staleness window if organizations need different sync cadences.
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function deriveConnectorCardStatus(
  connector: Connector,
  now: number = Date.now(),
): ConnectorCardStatus {
  if (!connector.enabled) return "disconnected";
  if (
    connector.lastTestOutcome === "failure" &&
    connector.lastTestErrorCode !== null &&
    UNAUTHORIZED_ERROR_CODES.has(connector.lastTestErrorCode)
  ) {
    return "unauthorized";
  }
  if (connector.activeSyncRunStatus === "failed") return "failed";
  if (connector.circuitState === "open") return "partial-provider-outage";
  if (
    connector.lastTestOutcome === "failure" &&
    connector.lastTestErrorCode !== null &&
    RATE_LIMITED_ERROR_CODES.has(connector.lastTestErrorCode)
  ) {
    return "rate-limited";
  }
  if (connector.activeSyncRunStatus === "retrying") return "retrying";
  if (
    connector.activeSyncRunStatus === "queued" ||
    connector.activeSyncRunStatus === "running" ||
    connector.activeSyncRunStatus === "waiting_for_review"
  ) {
    return "syncing";
  }
  const freshness = connector.lastCommittedAt ?? connector.cursorIssuedAt;
  if (freshness !== null && freshness !== undefined) {
    const age = now - new Date(freshness).getTime();
    if (Number.isFinite(age) && age > STALE_THRESHOLD_MS) return "stale";
  }
  return "connected";
}

export const CONNECTOR_CARD_STATUS_LABEL: Readonly<
  Record<ConnectorCardStatus, string>
> = {
  disconnected: "Disconnected",
  unauthorized: "Unauthorized",
  "partial-provider-outage": "Partial provider outage",
  "rate-limited": "Rate limited",
  retrying: "Retrying",
  syncing: "Syncing",
  failed: "Failed",
  stale: "Stale",
  connected: "Connected",
};

export const CONNECTOR_CARD_STATUS_TONE: Readonly<
  Record<ConnectorCardStatus, TagTone | undefined>
> = {
  disconnected: undefined,
  unauthorized: "red",
  "partial-provider-outage": "orange",
  "rate-limited": "orange",
  retrying: "orange",
  syncing: "blue",
  failed: "red",
  stale: "orange",
  connected: "green",
};
