/** Outcome codes surfaced across every connector RPC, mapped to HTTP by ConnectorsService. */
export type ConnectorErrorCode =
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "invalid_state"
  | "already_running"
  | "dry_run_expired"
  | "stale_preview"
  | "blocked_by_conflicts"
  | "forbidden_by_policy"
  | "retryable_unavailable"
  | "unavailable"
  | "rate_limited"
  | "payload_too_large"
  | "unsupported_content_type"
  | "idempotency_mismatch";

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message = `Connector request failed: ${code}`,
  ) {
    super(message);
  }
}
