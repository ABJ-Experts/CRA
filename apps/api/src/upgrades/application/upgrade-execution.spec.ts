/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- Controlled async test doubles do not access dynamic this. */
import { UpgradeExecutionEngine } from "./upgrade-execution";
import type {
  DeploymentLifecyclePort,
  DeploymentObservation,
  DeploymentPlan,
  ExecutionJournalPort,
  ExecutionSnapshot,
} from "./deployment-lifecycle.port";

const image = {
  service: "api",
  digest: "sha256:previous",
  imageId: "sha256:old",
  platform: "linux/amd64",
};
const candidate = { ...image, digest: "sha256:next", imageId: "sha256:new" };
const plan: DeploymentPlan = {
  runId: "run",
  fingerprint: "approved",
  previousImages: [image],
  candidateImages: [candidate],
  migrations: [{ name: "2", sha256: "hash", sql: "select 1" }],
  baselineLedger: ["1"],
  expectedLedgerDigest: "target-ledger",
  targetSchemaDigest: "target-schema",
  previousCompatibleAfterCandidateWrites: true,
};
function fixture(initial: ExecutionSnapshot | null = null) {
  let state = initial;
  const receipts: ExecutionSnapshot[] = [];
  let observation: DeploymentObservation = {
    maintenance: true,
    claimsStopped: true,
    drained: true,
    effectsCertain: true,
    images: [image],
    ledger: ["1"],
    ledgerDigest: "target-ledger",
    schemaDigest: "target-schema",
    candidateReady: false,
    workersReady: false,
  };
  const journal: ExecutionJournalPort = {
    withExclusive: async (effect) => effect(),
    read: async () => state,
    currentVersion: async () => state?.version ?? 0,
    append: async (_run, version, next) => {
      expect(version).toBe(state?.version ?? 0);
      state = { ...next, version: version + 1 };
      receipts.push(state);
      return state;
    },
  };
  const lifecycle = Object.fromEntries(
    [
      "assertFresh",
      "closeIngress",
      "stopClaims",
      "drain",
      "holdVerifiedBackup",
      "migrate",
      "startCandidate",
      "verifyCandidate",
      "startWorkers",
      "openIngress",
      "verifyActivated",
      "restorePreviousImages",
    ].map((name) => [
      name,
      jest.fn(async () => {
        if (name !== "assertFresh") expect(state?.pendingEffect).not.toBeNull();
        if (name === "startWorkers" || name === "openIngress")
          expect(state?.exposurePossible).toBe(true);
        if (name === "migrate")
          observation = { ...observation, ledger: ["1", "2"] };
        if (name === "startCandidate")
          observation = {
            ...observation,
            images: [candidate],
            candidateReady: true,
          };
        if (name === "restorePreviousImages")
          observation = {
            ...observation,
            images: [image],
            candidateReady: true,
          };
      }),
    ]),
  ) as unknown as jest.Mocked<DeploymentLifecyclePort>;
  lifecycle.observe = jest.fn(async () => observation);
  return {
    engine: new UpgradeExecutionEngine(lifecycle, journal),
    lifecycle,
    receipts,
    setObservation: (next: Partial<DeploymentObservation>) => {
      observation = { ...observation, ...next };
    },
  };
}
const pending = (
  effect: ExecutionSnapshot["pendingEffect"],
  exposurePossible = false,
): ExecutionSnapshot => ({
  version: 3,
  phase: "migrating",
  fingerprint: "approved",
  pendingEffect: effect,
  completed: [],
  exposurePossible,
  reason: null,
});
describe("UpgradeExecutionEngine", () => {
  it("journals every effect and exposure before activation", async () => {
    const f = fixture();
    expect((await f.engine.execute(plan)).phase).toBe("succeeded");
    expect(f.lifecycle.migrate).toHaveBeenCalledTimes(1);
    expect(f.receipts.filter((r) => r.pendingEffect !== null)).toHaveLength(10);
  });
  it("refuses stale approval before effects", async () => {
    const f = fixture();
    f.lifecycle.assertFresh.mockRejectedValue(new Error("stale"));
    await expect(f.engine.execute(plan)).rejects.toThrow("stale");
    expect(f.lifecycle.closeIngress).not.toHaveBeenCalled();
  });
  it("blocks incomplete drains without migrating or rolling back", async () => {
    const f = fixture();
    f.setObservation({ drained: false });
    expect((await f.engine.execute(plan)).phase).toBe("blocked");
    expect(f.lifecycle.migrate).not.toHaveBeenCalled();
    expect(f.lifecycle.restorePreviousImages).not.toHaveBeenCalled();
  });
  it("restores exact images after bootstrap failure retaining candidate writes and schema", async () => {
    const f = fixture();
    f.lifecycle.verifyCandidate.mockRejectedValue(new Error("bootstrap"));
    expect((await f.engine.execute(plan)).phase).toBe("rolled-back");
    expect(f.lifecycle.restorePreviousImages).toHaveBeenCalledWith(
      plan.previousImages,
    );
    expect(f.lifecycle.migrate).toHaveBeenCalledTimes(1);
    expect(f.lifecycle.openIngress).not.toHaveBeenCalled();
  });
  it.each(["startWorkers", "openIngress", "verifyActivated"] as const)(
    "never automatically rolls back after %s intent",
    async (method) => {
      const f = fixture();
      f.lifecycle[method].mockRejectedValue(new Error("lost acknowledgement"));
      expect((await f.engine.execute(plan)).phase).toBe("blocked");
      expect(f.lifecycle.restorePreviousImages).not.toHaveBeenCalled();
    },
  );
  it("reconciles a committed migration without repeating it", async () => {
    const f = fixture(pending("migrate"));
    f.setObservation({ ledger: ["1", "2"] });
    const result = await f.engine.reconcile(plan);
    expect(result.completed).toContain("migrate");
    expect(result.pendingEffect).toBeNull();
    expect(f.lifecycle.migrate).not.toHaveBeenCalled();
  });
  it.each([["1"], ["1", "unexpected"]])(
    "blocks uncertain migration outcome %j",
    async (...ledger) => {
      const f = fixture(pending("migrate"));
      f.setObservation({ ledger });
      expect((await f.engine.reconcile(plan)).phase).toBe("blocked");
      expect(f.lifecycle.migrate).not.toHaveBeenCalled();
    },
  );
  it("blocks restart after exposure intent regardless of observed worker state", async () => {
    const f = fixture(pending("start-workers", true));
    expect((await f.engine.reconcile(plan)).phase).toBe("blocked");
    expect(f.lifecycle.restorePreviousImages).not.toHaveBeenCalled();
  });
  it("blocks uncertain drain and image states", async () => {
    for (const effect of ["drain", "start-candidate", "hold-backup"] as const) {
      const f = fixture(pending(effect));
      f.setObservation({ effectsCertain: false });
      expect((await f.engine.reconcile(plan)).phase).toBe("blocked");
    }
  });
  it("keeps rollback failures blocked", async () => {
    const f = fixture();
    f.lifecycle.verifyCandidate.mockRejectedValue(new Error("bad"));
    f.lifecycle.restorePreviousImages.mockRejectedValue(new Error("bad"));
    expect((await f.engine.execute(plan)).phase).toBe("blocked");
  });
  it("forbids rollback without previous compatibility evidence", async () => {
    const f = fixture();
    f.lifecycle.verifyCandidate.mockRejectedValue(new Error("bad"));
    expect(
      (
        await f.engine.execute({
          ...plan,
          previousCompatibleAfterCandidateWrites: false,
        })
      ).phase,
    ).toBe("blocked");
    expect(f.lifecycle.restorePreviousImages).not.toHaveBeenCalled();
  });
});
describe("restart and manual image recovery", () => {
  it.each(["close-ingress", "stop-claims", "drain"] as const)(
    "reconciles proven %s without another effect",
    async (effect) => {
      const f = fixture(pending(effect));
      expect((await f.engine.reconcile(plan)).completed).toContain(effect);
    },
  );
  it.each(["start-candidate", "verify-candidate"] as const)(
    "reconciles exact healthy candidate for %s",
    async (effect) => {
      const f = fixture(pending(effect));
      f.setObservation({
        images: [candidate],
        candidateReady: true,
        ledger: ["1", "2"],
      });
      expect((await f.engine.reconcile(plan)).completed).toContain(effect);
    },
  );
  it("reconciles previous exact images after lost rollback acknowledgement", async () => {
    const f = fixture({
      ...pending("restore-previous"),
      reason: "rollback-unconfirmed",
    });
    f.setObservation({ candidateReady: true, ledger: ["1", "2"] });
    expect(await f.engine.reconcile(plan)).toMatchObject({
      phase: "rolled-back",
      reason: null,
    });
  });
  it("does not accept a different observed image identity", async () => {
    const f = fixture(pending("start-candidate"));
    f.setObservation({
      images: [{ ...candidate, imageId: "wrong" }],
      candidateReady: true,
    });
    expect((await f.engine.reconcile(plan)).phase).toBe("blocked");
  });
  it("rejects absent or mismatched run identity", async () => {
    await expect(fixture().engine.reconcile(plan)).rejects.toThrow("conflict");
    await expect(fixture().engine.rollback(plan)).rejects.toThrow("conflict");
    const f = fixture({ ...pending(null), fingerprint: "other" });
    await expect(f.engine.execute(plan)).rejects.toThrow("conflict");
    await expect(f.engine.reconcile(plan)).rejects.toThrow("conflict");
  });
  it("keeps confirmed receipts stable and terminal execution idempotent", async () => {
    const state = { ...pending(null), phase: "succeeded" as const };
    const f = fixture(state);
    expect(await f.engine.reconcile(plan)).toEqual(state);
    expect(await f.engine.execute(plan)).toEqual(state);
    expect(f.lifecycle.migrate).not.toHaveBeenCalled();
  });
  it("resumes after confirmed migration without executing it twice", async () => {
    const f = fixture({
      ...pending(null),
      completed: [
        "close-ingress",
        "stop-claims",
        "drain",
        "hold-backup",
        "migrate",
      ],
    });
    f.setObservation({ ledger: ["1", "2"] });
    expect((await f.engine.execute(plan)).phase).toBe("succeeded");
    expect(f.lifecycle.migrate).not.toHaveBeenCalled();
  });
  it("reconciles migration commit-before-error, preserving the acknowledgement", async () => {
    const f = fixture();
    f.lifecycle.migrate.mockImplementation(async () => {
      f.setObservation({ ledger: ["1", "2"] });
      throw new Error("lost ack");
    });
    expect((await f.engine.execute(plan)).completed).toContain("migrate");
  });
  it("allows explicit exact-image rollback only with retained target ledger", async () => {
    const f = fixture({
      ...pending(null),
      phase: "blocked",
      reason: "rollback-unconfirmed",
    });
    f.setObservation({ ledger: ["1", "2"] });
    expect(await f.engine.rollback(plan)).toMatchObject({
      phase: "rolled-back",
      reason: null,
    });
    expect(await f.engine.rollback(plan)).toMatchObject({
      phase: "rolled-back",
      reason: null,
    });
    expect(f.lifecycle.restorePreviousImages).toHaveBeenCalledTimes(1);
  });
  it("rejects explicit rollback after exposure or missing expanded schema", async () => {
    expect(
      (await fixture(pending(null, true)).engine.rollback(plan)).phase,
    ).toBe("blocked");
    expect((await fixture(pending(null)).engine.rollback(plan)).phase).toBe(
      "blocked",
    );
  });
  it("never rolls back an uncertain external effect", async () => {
    const f = fixture();
    f.lifecycle.verifyCandidate.mockImplementation(async () => {
      f.setObservation({ effectsCertain: false });
      throw new Error("uncertain");
    });
    expect((await f.engine.execute(plan)).phase).toBe("blocked");
    expect(f.lifecycle.restorePreviousImages).not.toHaveBeenCalled();
  });
  it("cannot declare previous images healthy solely from successful Compose exit", async () => {
    const f = fixture();
    f.lifecycle.verifyCandidate.mockRejectedValue(new Error("bad"));
    f.lifecycle.restorePreviousImages.mockResolvedValue(undefined);
    expect((await f.engine.execute(plan)).phase).toBe("blocked");
  });
});

it.each([
  { ledgerDigest: "different-statements" },
  { schemaDigest: "unexpected-schema" },
])(
  "does not acknowledge same migration version with wrong proof %j",
  async (proof) => {
    const f = fixture(pending("migrate"));
    f.setObservation({ ledger: ["1", "2"], ...proof });
    expect((await f.engine.reconcile(plan)).phase).toBe("blocked");
    expect(f.lifecycle.migrate).not.toHaveBeenCalled();
  },
);
