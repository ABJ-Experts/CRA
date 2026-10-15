import { withBackupAssurance } from "../domain/backup-health-projection";
import { SystemHealthUseCases } from "../../system-health/application/system-health.use-cases";
it("keeps v1 immutable and maps unavailable and measured backup authority separately", async () => {
  const useCase = new SystemHealthUseCases(
    {
      readSource: (_org, _actor, source) =>
        Promise.resolve({
          outcome: "withheld",
          source,
          sourceAt: null,
          observedAt: null,
          data: null,
          reasons: ["source_permission_withheld"],
        }),
    },
    {
      database: () => Promise.resolve(true),
      audit: () => Promise.resolve(true),
      storage: () => Promise.resolve(true),
    },
    null,
  );
  const v1 = await useCase.read(
    "20000000-0000-4000-8000-000000000001",
    "actor",
  );
  const unknown = {
    status: "unavailable" as const,
    lastAttempt: null,
    lastCapture: null,
    lastVerification: null,
    lastVerifiedRestoreAt: null,
    recoverablePointAt: null,
    verificationDueAt: null,
    residency: null,
    sourceAt: null,
    observedAt: "2026-10-14T00:00:00.000Z",
    reasons: ["not_configured" as const],
  };
  const v2 = withBackupAssurance(v1, unknown);
  expect(v2.schemaVersion).toBe(2);
  expect(v2.components.find((item) => item.id === "backups")?.status).toBe(
    "unknown",
  );
  expect(v1.backup.status).toBe("unknown");
  expect(v1.schemaVersion).toBe(1);
  const failed = withBackupAssurance(v1, {
    ...unknown,
    status: "failed",
    reasons: ["capture_failed"],
  });
  expect(failed.components.find((item) => item.id === "backups")?.status).toBe(
    "degraded",
  );
});
it("can show healthy backup authority only with genuine independent capture and restore timestamps", async () => {
  const useCase = new SystemHealthUseCases(
    {
      readSource: (_org, _actor, source) =>
        Promise.resolve({
          outcome: "withheld",
          source,
          sourceAt: null,
          observedAt: null,
          data: null,
          reasons: ["source_permission_withheld"],
        }),
    },
    {
      database: () => Promise.resolve(true),
      audit: () => Promise.resolve(true),
      storage: () => Promise.resolve(true),
    },
    null,
  );
  const v1 = await useCase.read(
    "20000000-0000-4000-8000-000000000001",
    "actor",
  );
  const at = "2026-10-14T00:00:00.000Z";
  const row = {
    id: "30000000-0000-4000-8000-000000000001",
    kind: "capture" as const,
    state: "certified" as const,
    createdAt: at,
    completedAt: at,
    durationMs: 1,
    integrity: "passed" as const,
    failureCode: null,
  };
  const projected = withBackupAssurance(v1, {
    status: "verified",
    lastAttempt: row,
    lastCapture: row,
    lastVerification: { ...row, kind: "verification", state: "verified" },
    lastVerifiedRestoreAt: at,
    recoverablePointAt: at,
    verificationDueAt: "2026-11-13T00:00:00.000Z",
    residency: "local",
    sourceAt: at,
    observedAt: at,
    reasons: [],
  });
  expect(
    projected.components.find((item) => item.id === "backups")?.status,
  ).toBe("healthy");
});
