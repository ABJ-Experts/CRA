import { BackupAssuranceUseCases } from "./backup-assurance.use-cases";
const assurance = {
  status: "unavailable",
  lastAttempt: null,
  lastCapture: null,
  lastVerification: null,
  lastVerifiedRestoreAt: null,
  recoverablePointAt: null,
  verificationDueAt: null,
  residency: null,
  sourceAt: null,
  observedAt: "2026-10-14T00:00:00.000Z",
  reasons: ["not_configured"],
};
const row = {
  id: "20000000-0000-4000-8000-000000000001",
  kind: "capture",
  state: "failed",
  createdAt: assurance.observedAt,
  completedAt: assurance.observedAt,
  durationMs: 4,
  integrity: "failed",
  failureCode: "object_missing",
};
it("uses org-first authority and closed customer fields", async () => {
  const read = jest.fn().mockResolvedValue({
    outcome: "ok",
    assurance,
    history: { items: [row], nextCursor: null },
  });
  const service = new BackupAssuranceUseCases({ read });
  await expect(service.summary("org", "actor")).resolves.toEqual(assurance);
  await expect(service.history("org", "actor", 3)).resolves.toEqual({
    items: [row],
    nextCursor: null,
  });
  expect(read).toHaveBeenLastCalledWith(
    "org",
    "actor",
    3,
    undefined,
    undefined,
  );
  await expect(service.summary("", "actor")).rejects.toThrow(
    "Backup assurance unavailable",
  );
  read.mockResolvedValueOnce({ outcome: "forbidden" });
  await expect(service.summary("org", "actor")).rejects.toThrow(
    "Backup assurance unavailable",
  );
  for (const result of [
    {
      outcome: "ok",
      assurance,
      history: {
        items: [{ ...row, repositoryPath: "secret" }],
        nextCursor: null,
      },
    },
    { outcome: "ok" },
  ]) {
    read.mockResolvedValueOnce(result);
    await expect(service.summary("org", "actor")).resolves.toMatchObject({
      status: "unavailable",
      reasons: ["authority_unavailable"],
    });
  }
});
