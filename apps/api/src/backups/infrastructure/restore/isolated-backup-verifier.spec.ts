/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- Asynchronous port doubles are asserted as mocks. */
import {
  IsolatedBackupVerifier,
  RecoveryCheckFailure,
  type RecoveryDependencies,
} from "./isolated-backup-verifier";
import type {
  BackupCertificate,
  BackupExecutionContext,
  BackupVerificationRequest,
} from "../../application/backup-execution.port";

const codes = [
  "ciphertext_authentication",
  "manifest_integrity",
  "schema_migrations",
  "extensions",
  "ownership_acl_rls",
  "sequences",
  "object_integrity",
  "audit_continuity",
  "external_keys",
  "credential_quarantine",
  "session_revocation",
  "dataset_markers",
  "authentication",
  "tenant_isolation",
  "product_isolation",
  "private_evidence_access",
  "egress_denied",
  "runtime_compatibility",
];
const certificate = {
  formatVersion: 1,
  instanceId: "instance",
  runId: "capture",
  repositoryGeneration: "generation",
  configurationRevision: 1,
  keyId: "key",
  capturedAt: new Date().toISOString(),
  checkpoint: {
    systemIdentifier: "123",
    timeline: 1,
    lsn: "0/1000000",
    postgresVersion: "17.6",
    restorePoint: "cra_backup_test",
  },
  parts: [],
  inventoryDigest: "a".repeat(64),
  auditHeadsDigest: "b".repeat(64),
  certificateDigest: "c".repeat(64),
} satisfies BackupCertificate;
const request: BackupVerificationRequest = {
  runId: "verify",
  instanceId: "instance",
  parentRunId: "capture",
  certificate,
  repositoryAlias: "repository",
  stagingAlias: "staging",
  keyAlias: "key",
  targetProfile: "local-saas",
};
function fixture() {
  const calls: string[] = [];
  const target = {
    assertIsolated: jest.fn(async () => {
      calls.push("isolate");
    }),
    restore: jest.fn(async () => {
      calls.push("restore");
    }),
    verifyHistorical: jest.fn(async () => {
      calls.push("history");
      return codes.slice(2, 9);
    }),
    quarantine: jest.fn(async () => {
      calls.push("quarantine");
      return ["credential_quarantine", "session_revocation", "dataset_markers"];
    }),
    probeApplication: jest.fn(async () => [
      "authentication",
      "tenant_isolation",
      "product_isolation",
      "private_evidence_access",
    ]),
    destroy: jest.fn(async () => {
      calls.push("destroy");
    }),
  };
  const dependencies: RecoveryDependencies = {
    openCertified: jest.fn(async () => {
      calls.push("authenticate");
      return {
        certificate,
        inventory: {
          catalog: {},
          auditHeads: [],
          objects: [],
          externalKeyChecks: [],
        },
        materialize: jest.fn(),
      };
    }),
    createTarget: jest.fn(async () => {
      calls.push("create");
      return target;
    }),
  };
  const context: BackupExecutionContext = {
    signal: new AbortController().signal,
    checkpoint: jest.fn(async () => {}),
    assertAuthority: jest.fn(async () => {}),
  };
  return {
    calls,
    target,
    dependencies,
    context,
    verifier: new IsolatedBackupVerifier(dependencies),
  };
}
describe("clean target verification", () => {
  it("preserves completed checks and reports the actual later failing check", async () => {
    const f = fixture();
    f.target.probeApplication.mockRejectedValue(
      new RecoveryCheckFailure("private_evidence_access", [
        "authentication",
        "tenant_isolation",
        "product_isolation",
      ]),
    );
    const result = await f.verifier.verify(request, f.context);
    expect(
      result.checks.find((check) => check.code === "authentication")?.status,
    ).toBe("passed");
    expect(
      result.checks.find((check) => check.code === "product_isolation")?.status,
    ).toBe("passed");
    expect(
      result.checks.find((check) => check.code === "private_evidence_access")
        ?.status,
    ).toBe("failed");
  });
  it("measures nonnegative durations when the wall clock moves backwards", async () => {
    const f = fixture();
    const clock = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValue(-5000);
    try {
      const result = await f.verifier.verify(request, f.context);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.checks.every((check) => check.durationMs >= 0)).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
  it("starts the mounted verification deadline before authenticating the repository", async () => {
    const f = fixture();
    const original = jest
      .mocked(f.dependencies.openCertified)
      .getMockImplementation()!;
    const dependencies = {
      ...f.dependencies,
      maximumDurationMs: () => 20,
      openCertified: jest.fn(
        async (...args: Parameters<RecoveryDependencies["openCertified"]>) => {
          await new Promise<void>((resolve, reject) => {
            const fallback = setTimeout(resolve, 100);
            args[1].addEventListener(
              "abort",
              () => {
                clearTimeout(fallback);
                reject(new Error("bounded native operation aborted"));
              },
              { once: true },
            );
          });
          return original(...args);
        },
      ),
    };
    const result = await new IsolatedBackupVerifier(dependencies).verify(
      request,
      f.context,
    );
    expect(result.verified).toBe(false);
    expect(f.dependencies.createTarget).not.toHaveBeenCalled();
    expect(dependencies.openCertified.mock.calls[0]![1].aborted).toBe(true);
  });
  it("refuses unsafe mounted deadlines before any source work", async () => {
    for (const maximum of [0, -1, Infinity, 14_400_001]) {
      const f = fixture();
      const verifier = new IsolatedBackupVerifier({
        ...f.dependencies,
        maximumDurationMs: () => maximum,
      });
      expect((await verifier.verify(request, f.context)).verified).toBe(false);
      expect(f.dependencies.openCertified).not.toHaveBeenCalled();
    }
  });
  it("authenticates before provision, checks history before quarantine, destroys only its target", async () => {
    const f = fixture();
    const result = await f.verifier.verify(request, f.context);
    expect(result.verified).toBe(true);
    expect(result.checks).toHaveLength(18);
    expect(f.calls).toEqual([
      "authenticate",
      "create",
      "isolate",
      "restore",
      "history",
      "quarantine",
      "destroy",
    ]);
  });
  it("refuses mismatched source binding before repository access", async () => {
    const f = fixture();
    const result = await f.verifier.verify(
      { ...request, instanceId: "other" },
      f.context,
    );
    expect(result.verified).toBe(false);
    expect(f.dependencies.openCertified).not.toHaveBeenCalled();
    expect(f.dependencies.createTarget).not.toHaveBeenCalled();
  });
  it("does not create a target for unauthenticated ciphertext", async () => {
    const f = fixture();
    jest
      .mocked(f.dependencies.openCertified)
      .mockRejectedValue(new Error("secret canary"));
    const result = await f.verifier.verify(request, f.context);
    expect(result.verified).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret canary");
    expect(f.dependencies.createTarget).not.toHaveBeenCalled();
  });
  it("cannot quarantine or certify when historical integrity fails", async () => {
    const f = fixture();
    f.target.verifyHistorical.mockRejectedValue(new Error("corrupt"));
    const result = await f.verifier.verify(request, f.context);
    expect(result.verified).toBe(false);
    expect(f.target.quarantine).not.toHaveBeenCalled();
    expect(f.target.destroy).toHaveBeenCalled();
  });
  it("does not mark missing application probes as verified", async () => {
    const f = fixture();
    f.target.probeApplication.mockResolvedValue([]);
    expect((await f.verifier.verify(request, f.context)).verified).toBe(false);
  });
  it("rejects unknown successful provider check codes instead of claiming complete verification", async () => {
    const f = fixture();
    f.target.probeApplication.mockResolvedValue([
      "authentication",
      "tenant_isolation",
      "product_isolation",
      "private_evidence_access",
      "raw_exception_canary",
    ]);
    const result = await f.verifier.verify(request, f.context);
    expect(result.verified).toBe(false);
    expect(JSON.stringify(result)).not.toContain("raw_exception_canary");
  });
  it("honors cancellation and fresh authority before each stage", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await f.verifier.verify(request, {
          ...f.context,
          signal: controller.signal,
        })
      ).verified,
    ).toBe(false);
    expect(f.dependencies.openCertified).not.toHaveBeenCalled();
    const g = fixture();
    jest
      .mocked(g.context.assertAuthority)
      .mockRejectedValue(new Error("revoked"));
    expect((await g.verifier.verify(request, g.context)).verified).toBe(false);
    expect(g.dependencies.openCertified).not.toHaveBeenCalled();
  });
  it("fails the isolation stage before restoring and still destroys the target", async () => {
    const f = fixture();
    f.target.assertIsolated.mockRejectedValue(new Error("egress"));
    expect((await f.verifier.verify(request, f.context)).verified).toBe(false);
    expect(f.target.restore).not.toHaveBeenCalled();
    expect(f.target.destroy).toHaveBeenCalled();
  });
});
