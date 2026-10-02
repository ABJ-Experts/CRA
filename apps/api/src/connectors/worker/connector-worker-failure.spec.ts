import { ConnectorError } from "../application/connector-errors";
import { ConnectorVaultUnavailableError } from "../application/connector-vault.port";
import {
  classifyConnectorWorkerFailure,
  ConnectorWorkerFailure,
} from "./connector-worker-failure";

describe("connector worker safe failure classification", () => {
  it.each([
    "timeout",
    "rate_limited",
    "provider_unavailable",
    "transient_database",
  ])("retries only known transient code %s", (code) => {
    expect(
      classifyConnectorWorkerFailure(new ConnectorWorkerFailure(code)),
    ).toMatchObject({ code, retryable: true });
  });
  it.each([
    "auth_failed",
    "cursor_invalid",
    "invalid_data",
    "authorization_changed",
    "unsupported_connector_type",
    "stale_preview",
  ])("does not retry deterministic failure %s", (code) => {
    expect(
      classifyConnectorWorkerFailure(new ConnectorWorkerFailure(code)),
    ).toMatchObject({ code, retryable: false });
  });
  it("never parses arbitrary exception text into a persisted category", () => {
    expect(
      classifyConnectorWorkerFailure(new ConnectorError("invalid_state")),
    ).toMatchObject({ code: "stale_preview", retryable: false });
    expect(
      classifyConnectorWorkerFailure(new ConnectorError("invalid_request")),
    ).toMatchObject({ code: "invalid_data", retryable: false });
    expect(
      classifyConnectorWorkerFailure(new Error("secret-canary rate_limited")),
    ).toEqual({
      code: "worker_exception",
      retryable: false,
      retryAfterSeconds: null,
    });
  });
  it("recognizes unavailable storage without exposing database details", () => {
    expect(
      classifyConnectorWorkerFailure(new ConnectorError("forbidden_by_policy")),
    ).toMatchObject({ code: "authorization_changed", retryable: false });
    expect(
      classifyConnectorWorkerFailure(
        new ConnectorError("unavailable", "private SQL canary"),
      ),
    ).toMatchObject({ code: "transient_database", retryable: true });
    expect(
      classifyConnectorWorkerFailure(new ConnectorVaultUnavailableError()),
    ).toMatchObject({ code: "vault_unavailable", retryable: false });
  });
  it("validates Retry-After seconds without clipping a valid long provider wait", () => {
    expect(
      classifyConnectorWorkerFailure(
        new ConnectorWorkerFailure("rate_limited", 900),
      ),
    ).toMatchObject({ retryAfterSeconds: 900 });
    for (const invalid of [-1, NaN, Infinity, 1.5])
      expect(
        classifyConnectorWorkerFailure(
          new ConnectorWorkerFailure("rate_limited", invalid),
        ),
      ).toMatchObject({ retryAfterSeconds: null });
  });
});
