import { ConnectorError } from "../application/connector-errors";
import { ConnectorVaultUnavailableError } from "../application/connector-vault.port";

/** Internal category only: never construct this from an upstream message. */
export class ConnectorWorkerFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super("Connector synchronization could not continue safely.");
  }
}

const retryableCodes = new Set([
  "timeout",
  "rate_limited",
  "provider_unavailable",
  "transient_database",
]);
const safeCodes = new Set([
  ...retryableCodes,
  "auth_failed",
  "cursor_expired",
  "cursor_invalid",
  "invalid_data",
  "authorization_changed",
  "configuration_changed",
  "unsupported_connector_type",
  "malformed_response",
  "unsupported_capability",
  "payload_too_large",
  "unreachable",
  "unknown",
  "stale_preview",
  "vault_unavailable",
  "worker_exception",
]);

export function classifyConnectorWorkerFailure(error: unknown): Readonly<{
  code: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
}> {
  if (error instanceof ConnectorVaultUnavailableError)
    return {
      code: "vault_unavailable",
      retryable: false,
      retryAfterSeconds: null,
    };
  if (error instanceof ConnectorError && error.code === "forbidden_by_policy")
    return {
      code: "authorization_changed",
      retryable: false,
      retryAfterSeconds: null,
    };
  if (
    error instanceof ConnectorError &&
    ["stale_preview", "invalid_state", "conflict", "dry_run_expired"].includes(
      error.code,
    )
  )
    return { code: "stale_preview", retryable: false, retryAfterSeconds: null };
  if (error instanceof ConnectorError && error.code === "invalid_request")
    return { code: "invalid_data", retryable: false, retryAfterSeconds: null };
  if (
    error instanceof ConnectorError &&
    ["unavailable", "retryable_unavailable"].includes(error.code)
  )
    return {
      code: "transient_database",
      retryable: true,
      retryAfterSeconds: null,
    };
  const code =
    error instanceof ConnectorWorkerFailure && safeCodes.has(error.code)
      ? error.code
      : "worker_exception";
  const wait =
    error instanceof ConnectorWorkerFailure ? error.retryAfterSeconds : null;
  return {
    code,
    retryable: retryableCodes.has(code),
    retryAfterSeconds:
      typeof wait === "number" && Number.isSafeInteger(wait) && wait >= 0
        ? wait
        : null,
  };
}
