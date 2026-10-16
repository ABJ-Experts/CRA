import { importApprovedUpgradeImages } from "./upgrade-image-admission";
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- In-memory async port doubles and Jest method assertions. */
import { UpgradeExecutionJournal } from "./upgrade-supervisor";
import type { UpgradeSupervisorJournal as UpgradeHostJournal } from "./upgrade-supervisor.port";
describe("supervisor execution journal", () => {
  it("rebases snapshot version to the global authenticated head", async () => {
    const snapshot = {
      phase: "ready",
      fingerprint: "a".repeat(64),
      pendingEffect: null,
      completed: [],
      exposurePossible: false,
      reason: null,
    };
    const journal = {
      read: jest.fn().mockResolvedValue([
        { sequence: 1, runId: "run", kind: "execution", data: snapshot },
        { sequence: 2, kind: "command", runId: "other", data: {} },
      ]),
      withExclusive: jest.fn((f: () => unknown) => f()),
    } as unknown as UpgradeHostJournal;
    const port = new UpgradeExecutionJournal(journal);
    expect(await port.read("run")).toEqual({ ...snapshot, version: 2 });
    expect(await port.read("missing")).toBeNull();
    expect(await port.currentVersion()).toBe(2);
  });
});

import {
  UpgradeSupervisor,
  type UpgradeSupervisorDependencies,
} from "./upgrade-supervisor";
import { OperatorGrantStore } from "../../operator/operator-security";
import { randomUUID } from "node:crypto";
import type {
  UpgradeJournalRecord as JournalRecord,
  UpgradeJournalAppend as JournalAppend,
  StagedUpgradeBundle as VerifiedUpgradeBundle,
} from "./upgrade-supervisor.port";
const instanceId = randomUUID(),
  mediaId = randomUUID();
const actor = {
  principalId: randomUUID(),
  fingerprint256: Array(32).fill("AA").join(":"),
  grantRevision: "1",
};
const now = "2026-10-15T00:00:00.000Z";
function supervisorFixture() {
  let records: JournalRecord[] = [];
  const journal = {
    read: async () => records,
    withExclusive: async <T>(f: () => Promise<T>) => f(),
    append: async (c: JournalAppend) => {
      if (c.expectedVersion !== records.length) throw new Error("conflict");
      const record = {
        ...c,
        sequence: records.length + 1,
        instanceId,
        previousHash: "",
        hash: "",
      };
      records = [...records, record];
      return record;
    },
  } as unknown as UpgradeHostJournal;
  jest.spyOn(OperatorGrantStore.prototype, "read").mockResolvedValue({
    revision: "1",
    grants: [
      {
        ...actor,
        instanceIds: [instanceId],
        tenantScopes: [],
        backupScopes: [],
        upgradeScopes: [
          {
            instanceId,
            actions: [
              "upgrades.view",
              "upgrades.stage",
              "upgrades.apply",
              "upgrades.rollback",
            ],
          },
        ],
      },
    ],
  });
  const bundle = {
    manifestDigest: "a".repeat(64),
    stagingId: randomUUID(),
    archivePath: "/private/payload",
    extractedRoot: "/private/content",
    manifest: {
      sequence: 1,
      releaseId: randomUUID(),
      version: "2.0.0",
      expectedOutageSeconds: 30,
      licenseEffects: ["unchanged"],
    },
  } as unknown as VerifiedUpgradeBundle;
  const deps: UpgradeSupervisorDependencies = {
    instanceId,
    readGrants: () => new OperatorGrantStore("/private/grants").read(),
    journal,
    now: () => new Date(now),
    media: {
      list: jest.fn(async () => ({
        items: [{ id: mediaId, label: "release", bytes: 1, discoveredAt: now }],
      })),
      verify: jest.fn(async () => bundle),
    },
    capabilities: async () => ({
      instanceId,
      enabled: true,
      actions: ["upgrades.view"],
      platform: { os: "linux", architecture: "amd64" },
      currentVersion: "1.0.0",
      supervisorVersion: "1.0.0",
      maintenance: false,
      version: 0,
    }),
    prepare: jest.fn(),
  };
  const control = new UpgradeSupervisor(deps);
  const call = (
    action: Parameters<UpgradeSupervisor["execute"]>[2],
    input: Record<string, unknown> = {},
  ) => control.execute(instanceId, actor, action, input);
  const settle = () =>
    new Promise<void>((resolve) => setImmediate(() => setImmediate(resolve)));
  return { control, call, deps, settle, records: () => records };
}
afterEach(() => jest.restoreAllMocks());
describe("supervisor command boundary", () => {
  it("authorizes every read and parses empty queries", async () => {
    const f = supervisorFixture();
    expect(await f.call("capabilities/read")).toMatchObject({
      enabled: true,
      version: 0,
    });
    expect(await f.call("media/list")).toMatchObject({
      items: [{ id: mediaId }],
    });
    await expect(
      f.call("media/list", { path: "/etc/passwd" }),
    ).rejects.toThrow();
    await expect(
      f.control.execute(randomUUID(), actor, "media/list"),
    ).rejects.toThrow();
    await expect(
      f.control.execute(
        instanceId,
        { ...actor, grantRevision: "old" },
        "media/list",
      ),
    ).rejects.toThrow();
    jest
      .spyOn(OperatorGrantStore.prototype, "read")
      .mockResolvedValue({ revision: "1", grants: [] });
    await expect(f.call("media/list")).rejects.toThrow();
  });
  it("stages asynchronously, persists restart identity and redacts paths", async () => {
    const f = supervisorFixture();
    const input = { expectedVersion: 0, idempotencyKey: randomUUID(), mediaId };
    const first = (await f.call("media/stage", input)) as { id: string };
    expect(first).toMatchObject({ state: "verifying" });
    await f.settle();
    const run = await f.call("run/read", { runId: first.id });
    expect(run).toMatchObject({ state: "preflight", verified: true });
    expect(JSON.stringify(run)).not.toContain("/private");
    const restarted = new UpgradeSupervisor(f.deps);
    expect(
      await restarted.execute(instanceId, actor, "media/stage", input),
    ).toEqual(run);
    expect(await f.call("run/list", {})).toMatchObject({
      items: [{ id: first.id }],
      nextCursor: null,
    });
    await expect(
      f.call("run/list", { cursor: randomUUID() }),
    ).rejects.toThrow();
    await expect(f.call("run/read", { runId: randomUUID() })).rejects.toThrow();
    await expect(f.call("run/result", { runId: first.id })).rejects.toThrow();
    await expect(
      f.call("media/stage", { ...input, mediaId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      f.call("media/stage", { ...input, idempotencyKey: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      f.call("run/apply", {
        runId: first.id,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
        acknowledgedEffects: true,
        fingerprint: "a".repeat(64),
      }),
    ).rejects.toThrow();
  });
  it("retains failed staging evidence without admitting sequence", async () => {
    const f = supervisorFixture();
    jest
      .mocked(f.deps.media.verify)
      .mockRejectedValue(new Error("private native detail"));
    const run = (await f.call("media/stage", {
      mediaId,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
    })) as { id: string };
    await f.settle();
    expect(await f.call("run/read", { runId: run.id })).toMatchObject({
      state: "failed",
      failureCode: "invalid-media",
    });
    const report = await f.call("run/result", { runId: run.id });
    expect(report).toMatchObject({
      outcome: "failed",
      instanceId,
      fromVersion: null,
      toVersion: null,
      manifestDigest: null,
      checkedAt: null,
      checks: [],
      imageDigests: [],
      safeRemediation: ["invalid-media"],
    });
    expect(JSON.stringify(report)).not.toContain("private native detail");
    expect(f.records().some((r) => r.kind === "admitted-sequence")).toBe(false);
    await expect(
      f.call("run/preflight", {
        runId: run.id,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();
  });
});
import * as policy from "../domain/upgrade-preflight";
import type { DeploymentLifecyclePort } from "./deployment-lifecycle.port";
import type { PreparedUpgrade } from "./upgrade-supervisor";
function prepareFixture(f: ReturnType<typeof supervisorFixture>) {
  jest.spyOn(policy, "preflightUpgrade").mockReturnValue({
    allowed: true,
    blockers: [],
    fingerprint: "a".repeat(64),
  });
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
    ].map((name) => [name, jest.fn(async () => undefined)]),
  ) as unknown as DeploymentLifecyclePort;
  lifecycle.observe = async () => ({
    maintenance: true,
    claimsStopped: true,
    drained: true,
    effectsCertain: true,
    images: [],
    ledger: [],
    ledgerDigest: "b".repeat(64),
    schemaDigest: "c".repeat(64),
    candidateReady: true,
    workersReady: true,
  });
  jest.mocked(f.deps.prepare).mockImplementation(
    async (_bundle, _actor, runId) =>
      ({
        facts: {
          currentVersion: "1.0.0",
          checkedAt: now,
          expiresAt: "2026-10-15T00:05:00.000Z",
        },
        plan: {
          runId,
          fingerprint: "a".repeat(64),
          previousImages: [],
          candidateImages: [
            {
              service: "api",
              digest: `sha256:${"d".repeat(64)}`,
              imageId: `sha256:${"d".repeat(64)}`,
              platform: "linux/amd64",
            },
          ],
          migrations: [],
          baselineLedger: [],
          expectedLedgerDigest: "b".repeat(64),
          targetSchemaDigest: "c".repeat(64),
          previousCompatibleAfterCandidateWrites: true,
        },
        lifecycle,
      }) as unknown as PreparedUpgrade,
  );
  f.deps.resume = async () => lifecycle;
  return lifecycle;
}
async function staged(f: ReturnType<typeof supervisorFixture>) {
  const run = (await f.call("media/stage", {
    mediaId,
    expectedVersion: 0,
    idempotencyKey: randomUUID(),
  })) as { id: string };
  await f.settle();
  return run.id;
}
describe("review and execution orchestration", () => {
  it("rejects rollback after a crash with durable exposure but no saved result", async () => {
    const f = supervisorFixture();
    prepareFixture(f);
    const runId = await staged(f);
    await f.call("run/preflight", {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
    });
    await f.deps.journal.append({
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
      kind: "execution",
      data: {
        phase: "exposing",
        fingerprint: "a".repeat(64),
        pendingEffect: "open-ingress",
        completed: [],
        exposurePossible: true,
        reason: null,
      },
    });
    const before = structuredClone(f.records());
    const resume = jest.spyOn(f.deps, "resume");
    const restarted = new UpgradeSupervisor(f.deps);
    await expect(
      restarted.execute(instanceId, actor, "run/rollback", {
        runId,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await f.settle();
    expect(f.records()).toEqual(before);
    expect(resume).not.toHaveBeenCalled();
  });

  it("returns truthful review summary and executes a durable approved run", async () => {
    const f = supervisorFixture();
    const lifecycle = prepareFixture(f);
    const runId = await staged(f);
    const input = {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
    };
    const review = await f.call("run/preflight", input);
    expect(review).toMatchObject({
      eligible: true,
      summary: {
        expectedOutageSeconds: 30,
        licenseEffects: ["unchanged"],
        dataRestored: false,
      },
    });
    expect(await f.call("run/preflight", input)).toEqual(review);
    await f.call("run/apply", {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
      fingerprint: "a".repeat(64),
      acknowledgedEffects: true,
    });
    await f.settle();
    expect(lifecycle.migrate).toHaveBeenCalledTimes(1);
    expect(await f.call("run/read", { runId })).toMatchObject({
      state: "success",
    });
    expect(await f.call("run/result", { runId })).toMatchObject({
      outcome: "success",
      instanceId,
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      manifestDigest: "a".repeat(64),
      checkedAt: now,
      safeRemediation: [],
      imageDigests: [`sha256:${"d".repeat(64)}`],
      exposurePossible: true,
      dataRestored: false,
    });
    const report = await f.call("run/result", { runId });
    const stored = f
      .records()
      .filter((record) => record.kind === "run")
      .at(-1);
    expect(JSON.stringify(f.records())).toContain(JSON.stringify(report));
    expect(stored).toBeDefined();
    expect(f.records().some((r) => r.kind === "admitted-sequence")).toBe(true);
    await f.call("run/reconcile", {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
    });
    await f.settle();
    const before = structuredClone(f.records());
    const finalReport = await f.call("run/result", { runId });
    const history = await f.call("run/list");
    const resume = jest.spyOn(f.deps, "resume");
    await expect(
      f.call("run/rollback", {
        runId,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await f.settle();
    expect(f.records()).toEqual(before);
    expect(await f.call("run/list")).toEqual(history);
    expect(await f.call("run/result", { runId })).toEqual(finalReport);
    expect(resume).not.toHaveBeenCalled();
    expect(lifecycle.restorePreviousImages).not.toHaveBeenCalled();
  });
  it("blocks failed reviews and stale approvals", async () => {
    const f = supervisorFixture();
    prepareFixture(f);
    const runId = await staged(f);
    jest.mocked(policy.preflightUpgrade).mockReturnValue({
      allowed: false,
      blockers: ["backup"],
      fingerprint: "a".repeat(64),
    });
    expect(
      await f.call("run/preflight", {
        runId,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
      }),
    ).toMatchObject({ eligible: false });
    jest.mocked(policy.preflightUpgrade).mockReturnValue({
      allowed: true,
      blockers: [],
      fingerprint: "a".repeat(64),
    });
    await f.call("run/preflight", {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
    });
    jest.mocked(policy.preflightUpgrade).mockReturnValue({
      allowed: false,
      blockers: ["backup"],
      fingerprint: "a".repeat(64),
    });
    await expect(
      f.call("run/apply", {
        runId,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
        fingerprint: "a".repeat(64),
        acknowledgedEffects: true,
      }),
    ).rejects.toThrow();
    expect(f.records().some((r) => r.kind === "admitted-sequence")).toBe(false);
  });
  it("retains maintenance and admitted sequence after candidate failure", async () => {
    const f = supervisorFixture();
    const lifecycle = prepareFixture(f);
    const runId = await staged(f);
    jest
      .mocked(lifecycle.verifyCandidate)
      .mockRejectedValue(new Error("native private"));
    await f.call("run/preflight", {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
    });
    await f.call("run/apply", {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
      fingerprint: "a".repeat(64),
      acknowledgedEffects: true,
    });
    await f.settle();
    expect(await f.call("run/result", { runId })).toMatchObject({
      outcome: "rolled-back",
      maintenanceRetained: true,
    });
    expect(lifecycle.restorePreviousImages).toHaveBeenCalledTimes(1);
    const report = await f.call("run/result", { runId });
    const stored = f
      .records()
      .filter((record) => record.kind === "run")
      .at(-1);
    expect(JSON.stringify(f.records())).toContain(JSON.stringify(report));
    expect(stored).toBeDefined();
    expect(f.records().some((r) => r.kind === "admitted-sequence")).toBe(true);
  });
});
describe("durable incomplete command recovery", () => {
  it("retries a failed preflight preparation without consuming its idempotency identity", async () => {
    const f = supervisorFixture();
    prepareFixture(f);
    const runId = await staged(f);
    const input = {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
    };
    jest
      .mocked(f.deps.prepare)
      .mockRejectedValueOnce(new Error("temporary source unavailable"));
    await expect(f.call("run/preflight", input)).rejects.toThrow();
    expect(await f.call("run/preflight", input)).toMatchObject({
      eligible: true,
    });
    expect(
      f.records().filter((r) => r.idempotencyKey === input.idempotencyKey),
    ).toHaveLength(1);
  });
  it("recovers a crash between stage command intent and initial run", async () => {
    const f = supervisorFixture();
    const input = { expectedVersion: 0, idempotencyKey: randomUUID(), mediaId };
    const runId = randomUUID();
    await f.deps.journal.append({
      expectedVersion: 0,
      idempotencyKey: input.idempotencyKey,
      runId,
      kind: "command",
      data: { actor, action: "media/stage", input },
    });
    expect(await f.call("media/stage", input)).toMatchObject({
      id: runId,
      state: "verifying",
    });
    await f.settle();
    expect(await f.call("run/read", { runId })).toMatchObject({
      state: "preflight",
    });
  });
  it("loads only after fresh approved apply and durable admission, never staging", async () => {
    const f = supervisorFixture();
    f.deps.flushAudit = jest.fn().mockResolvedValue(undefined);
    f.deps.loadImages = jest.fn(async () => {
      expect(f.records().at(-1)?.kind).toBe("image-load-intent");
      expect(
        f
          .records()
          .some(
            (r) =>
              r.kind === "run" &&
              (r.data.run as { verified: boolean }).verified,
          ),
      ).toBe(true);
    });
    prepareFixture(f);
    const runId = await staged(f);
    expect(f.deps.loadImages).not.toHaveBeenCalled();
    await f.call("run/preflight", {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
    });
    expect(f.deps.loadImages).not.toHaveBeenCalled();
    await f.call("run/apply", {
      runId,
      expectedVersion: f.records().length,
      idempotencyKey: randomUUID(),
      fingerprint: "a".repeat(64),
      acknowledgedEffects: true,
    });
    await f.settle();
    expect(f.deps.loadImages).toHaveBeenCalledTimes(1);
    expect(await f.call("run/read", { runId })).toMatchObject({
      state: "success",
    });
    expect(f.records().some((r) => r.kind === "image-load-result")).toBe(true);
    const bundle = await f.deps.media.verify(mediaId);
    const prepared = await f.deps.prepare(bundle, actor, runId);
    await importApprovedUpgradeImages(
      f.deps,
      actor,
      bundle,
      prepared.plan,
      prepared.lifecycle,
      () => f.control.authorize(actor, "run/apply"),
    );
    expect(f.deps.loadImages).toHaveBeenCalledTimes(1);
  });
  it("rebases execution after awaited audit acknowledgements", async () => {
    const f = supervisorFixture();
    const port = new UpgradeExecutionJournal(
      f.deps.journal,
      actor,
      async () => {
        await f.deps.journal.append({
          expectedVersion: f.records().length,
          idempotencyKey: randomUUID(),
          runId: "run",
          kind: "audit-ack",
          data: {},
        });
      },
    );
    const state = await port.append("run", 0, {
      phase: "ready",
      fingerprint: "approved",
      pendingEffect: null,
      completed: [],
      exposurePossible: false,
      reason: null,
    });
    expect(state.version).toBe(2);
    expect(f.records()[0]?.data.audit).toMatchObject({
      actorId: actor.principalId,
      action: "upgrade.execution",
    });
  });
});
describe("revoked forward authority after exposure", () => {
  it.each([false, true])(
    "closes safely under durable run authority and reports observed closure (closure fails: %s)",
    async (closureFails) => {
      const f = supervisorFixture();
      const lifecycle = prepareFixture(f);
      const authority = await f.deps.readGrants();
      let maintenance = true;
      const originalObservation = await lifecycle.observe();
      lifecycle.observe = jest.fn(async () => ({
        ...originalObservation,
        maintenance,
      }));
      jest.mocked(lifecycle.openIngress).mockImplementation(async () => {
        maintenance = false;
        jest
          .spyOn(OperatorGrantStore.prototype, "read")
          .mockResolvedValue({ ...authority, revision: "revoked" } as never);
      });
      jest.mocked(lifecycle.closeIngress).mockImplementation(async () => {
        if (!maintenance && closureFails)
          throw new Error("native closure failed");
        maintenance = true;
      });
      const runId = await staged(f);
      await f.call("run/preflight", {
        runId,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
      });
      await f.call("run/apply", {
        runId,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
        fingerprint: "a".repeat(64),
        acknowledgedEffects: true,
      });
      await f.settle();
      expect(lifecycle.closeIngress).toHaveBeenCalledTimes(2);
      expect(lifecycle.verifyActivated).not.toHaveBeenCalled();
      expect(lifecycle.restorePreviousImages).not.toHaveBeenCalled();
      jest
        .spyOn(OperatorGrantStore.prototype, "read")
        .mockResolvedValue(authority as never);
      expect(await f.call("run/result", { runId })).toMatchObject({
        outcome: "rollback-required",
        exposurePossible: true,
        maintenanceRetained: !closureFails,
      });
      const before = structuredClone(f.records());
      const resume = jest.spyOn(f.deps, "resume");
      await expect(
        f.call("run/rollback", {
          runId,
          expectedVersion: f.records().length,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ status: 409 });
      await f.settle();
      expect(f.records()).toEqual(before);
      expect(resume).not.toHaveBeenCalled();
      expect(lifecycle.restorePreviousImages).not.toHaveBeenCalled();
    },
  );
});
describe("approved image admission failure", () => {
  it.each(["revoked", "load-failed"])(
    "never activates after %s and preserves the admitted sequence",
    async (mode) => {
      const f = supervisorFixture();
      const lifecycle = prepareFixture(f);
      const authority = await f.deps.readGrants();
      f.deps.loadImages = jest
        .fn()
        .mockRejectedValue(new Error("bounded import refused"));
      const runId = await staged(f);
      expect(f.deps.loadImages).not.toHaveBeenCalled();
      await f.call("run/preflight", {
        runId,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
      });
      if (mode === "revoked")
        jest.mocked(lifecycle.assertFresh).mockImplementationOnce(async () => {
          jest
            .spyOn(OperatorGrantStore.prototype, "read")
            .mockResolvedValue({ ...authority, revision: "revoked" } as never);
        });
      await f.call("run/apply", {
        runId,
        expectedVersion: f.records().length,
        idempotencyKey: randomUUID(),
        fingerprint: "a".repeat(64),
        acknowledgedEffects: true,
      });
      await f.settle();
      expect(f.deps.loadImages).toHaveBeenCalledTimes(
        mode === "revoked" ? 0 : 1,
      );
      expect(lifecycle.migrate).not.toHaveBeenCalled();
      expect(lifecycle.startCandidate).not.toHaveBeenCalled();
      expect(lifecycle.openIngress).not.toHaveBeenCalled();
      expect(f.records().some((r) => r.kind === "admitted-sequence")).toBe(
        true,
      );
      expect(f.records().some((r) => r.kind === "image-load-result")).toBe(
        false,
      );
      jest
        .spyOn(OperatorGrantStore.prototype, "read")
        .mockResolvedValue(authority as never);
      expect(await f.call("run/result", { runId })).toMatchObject({
        outcome: "rollback-required",
        exposurePossible: false,
      });
    },
  );
});
