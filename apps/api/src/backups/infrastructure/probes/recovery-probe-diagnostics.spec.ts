import { RecoveryCheckFailure } from "../restore/isolated-backup-verifier";
import {
  emitRecoveryProbeDiagnostic,
  classifyRecoveryStorageFailure,
  recoveryProbeFailureProgress,
  recoveryProbeFailureCode,
  traceRecoveryProbe,
} from "./recovery-probe-diagnostics";
describe("closed recovery diagnostics", () => {
  afterEach(() => {
    delete process.env.CRA_BACKUP_PROBE_TRACE;
    jest.restoreAllMocks();
  });
  it("emits only closed status metadata and tolerates failed observers", () => {
    const observer = jest.fn();
    emitRecoveryProbeDiagnostic(observer, {
      stage: "http",
      service: "auth",
      status: 401,
    });
    expect(observer).toHaveBeenCalledWith({
      stage: "http",
      service: "auth",
      status: 401,
    });
    emitRecoveryProbeDiagnostic(observer, {
      stage: "http",
      secret: "canary",
    } as never);
    expect(observer).toHaveBeenCalledTimes(1);
    emitRecoveryProbeDiagnostic(
      () => {
        throw Error("unavailable");
      },
      { stage: "runtime", code: "ready" },
    );
    emitRecoveryProbeDiagnostic(undefined, { stage: "health", status: null });
  });
  it("prints safe traces only under the explicit private task flag", () => {
    const write = jest.spyOn(process.stderr, "write").mockReturnValue(true);
    traceRecoveryProbe({ stage: "runtime", code: "create_started" });
    expect(write).not.toHaveBeenCalled();
    process.env.CRA_BACKUP_PROBE_TRACE = "true";
    traceRecoveryProbe({ stage: "http", service: "auth", status: 500 });
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"status":500'));
  });
  it.each([
    ["ENOENT /private/canary", "storage_file_missing"],
    ["EACCES secret-token-canary", "storage_file_denied"],
    ["EPERM secret-token-canary", "storage_file_denied"],
    ["ENOTSUP xattr /private/canary", "storage_xattr_unavailable"],
    ["EOPNOTSUPP secret-token-canary", "storage_xattr_unavailable"],
    ["42501 permission denied", "storage_database_permission"],
    ["42703 column does not exist", "storage_database_schema"],
    ["42P01 relation does not exist", "storage_database_schema"],
    ["arbitrary token secret", "storage_provider_failure"],
  ])(
    "classifies safe Storage failures without echoing %s",
    (source, expected) => {
      expect(classifyRecoveryStorageFailure(source)).toBe(expected);
      expect(classifyRecoveryStorageFailure({ secret: source })).toBe(
        "storage_provider_failure",
      );
    },
  );
  it("carries only an ordered, bounded application-check prefix", () => {
    const error = new RecoveryCheckFailure("private_evidence_access", [
      "authentication",
      "tenant_isolation",
      "product_isolation",
    ]);
    expect(recoveryProbeFailureProgress(error)).toEqual({
      failedCheck: "private_evidence_access",
      completedChecks: [
        "authentication",
        "tenant_isolation",
        "product_isolation",
      ],
    });
    expect(recoveryProbeFailureCode(error)).toBe(
      "recovery_probe_evidence_access",
    );
    expect(
      recoveryProbeFailureCode(
        new RecoveryCheckFailure("tenant_isolation", ["authentication"]),
      ),
    ).toBe("recovery_probe_tenant_isolation");
    expect(
      recoveryProbeFailureProgress(
        new RecoveryCheckFailure("object_integrity", []),
      ),
    ).toBeUndefined();
    expect(
      recoveryProbeFailureProgress(
        new RecoveryCheckFailure("product_isolation", [
          "authentication",
          "authentication",
        ]),
      ),
    ).toBeUndefined();
    expect(
      recoveryProbeFailureProgress({
        failedCheck: "authentication",
        completedChecks: [],
      }),
    ).toBeUndefined();
  });
  it("never echoes provider error messages", () => {
    expect(
      recoveryProbeFailureCode(Error("recovery_probe_authentication")),
    ).toBe("recovery_probe_authentication");
    expect(recoveryProbeFailureCode(Error("secret-token-canary"))).toBe(
      "recovery_probe_unexpected_failure",
    );
    expect(recoveryProbeFailureCode("secret")).toBe(
      "recovery_probe_unexpected_failure",
    );
  });
});
