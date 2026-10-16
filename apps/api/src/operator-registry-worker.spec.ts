import { PrivateMetadataTransport } from "./operator/operator-transport";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runOperatorObserver,
  bootstrapOperatorRegistryWorker,
  createOperatorWorkerRepository,
} from "./operator-registry-worker";
const instanceId = "20000000-0000-4000-8000-000000000001";
it("disabled worker never opens a repository", async () => {
  const factory = jest.fn();
  await bootstrapOperatorRegistryWorker({}, ["--once"], factory);
  expect(factory).not.toHaveBeenCalled();
});
it("bounds local observer pages to the stable instance and one observation time", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  const repo = {
    observe: jest
      .fn()
      .mockImplementation(
        (_id: string, _stamp: string, cursor: string | null) =>
          Promise.resolve({
            schemaVersion: 1,
            instanceId,
            revision: 1,
            sourceAt: stamp,
            observedAt: stamp,
            instance: { instanceId, label: "Local" },
            tenants: [],
            nextCursor: cursor ? null : "30000000000040008000000000000001",
          }),
      ),
  };
  await runOperatorObserver(instanceId, repo, () => Date.parse(stamp));
  expect(repo.observe).toHaveBeenCalledTimes(2);
  expect(repo.observe.mock.calls[1]).toEqual([
    instanceId,
    stamp,
    "30000000-0000-4000-8000-000000000001",
  ]);
});
it("one-shot observer worker uses its fixed source repository and preserves failure isolation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-worker-entry-"));
  try {
    const path = join(directory, "key");
    await writeFile(path, "credential", { mode: 0o600 });
    const repository = {
      observe: jest.fn().mockImplementation(() =>
        Promise.resolve({
          schemaVersion: 1,
          instanceId,
          revision: 1,
          sourceAt: new Date().toISOString(),
          observedAt: new Date().toISOString(),
          instance: { instanceId, label: "Local" },
          tenants: [],
          nextCursor: null,
        }),
      ),
      failure: jest.fn(),
      publish: jest.fn(),
    };
    const factory = jest.fn().mockReturnValue(repository);
    await bootstrapOperatorRegistryWorker(
      {
        OPERATOR_OBSERVER_ENABLED: "true",
        LICENSING_INSTANCE_ID: instanceId,
        SUPABASE_URL: "http://127.0.0.1:54321",
        OPERATOR_WORKER_CREDENTIAL_PATH: path,
      },
      ["--once"],
      factory,
    );
    expect(repository.observe).toHaveBeenCalledTimes(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("denies repeated local observer cursors", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  await expect(
    runOperatorObserver(
      instanceId,
      {
        observe: () =>
          Promise.resolve({
            schemaVersion: 1,
            instanceId,
            revision: 1,
            sourceAt: stamp,
            observedAt: stamp,
            instance: { instanceId, label: "Local" },
            tenants: [],
            nextCursor: instanceId.replace(/-/g, ""),
          }),
      },
      () => Date.parse(stamp),
    ),
  ).rejects.toThrow("Repeated local observer cursor");
});

it("defaults to disabled process flags and constructs only the separate worker adapter", async () => {
  const beforeObserver = process.env.OPERATOR_OBSERVER_ENABLED;
  const beforeCollector = process.env.OPERATOR_COLLECTOR_ENABLED;
  process.env.OPERATOR_OBSERVER_ENABLED = "false";
  process.env.OPERATOR_COLLECTOR_ENABLED = "false";
  try {
    await bootstrapOperatorRegistryWorker();
    const key = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
    expect(
      createOperatorWorkerRepository("http://127.0.0.1:54321", key),
    ).toBeDefined();
  } finally {
    if (beforeObserver === undefined)
      delete process.env.OPERATOR_OBSERVER_ENABLED;
    else process.env.OPERATOR_OBSERVER_ENABLED = beforeObserver;
    if (beforeCollector === undefined)
      delete process.env.OPERATOR_COLLECTOR_ENABLED;
    else process.env.OPERATOR_COLLECTOR_ENABLED = beforeCollector;
  }
});
it("keeps collector polling independent when local source observation fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-worker-isolation-"));
  const log = jest
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  try {
    const path = join(directory, "credential");
    await writeFile(path, "credential", { mode: 0o600 });
    const factory = jest.fn().mockReturnValue({
      observe: () => Promise.reject(new Error("private metadata failure")),
      publish: () => Promise.resolve(),
      failure: () => Promise.resolve(),
    });
    const sleep = () => Promise.reject(new Error("test cycle completed"));
    const targetPath = join(directory, "targets.json");
    await writeFile(
      targetPath,
      JSON.stringify([
        {
          instanceId,
          endpoint: "https://127.0.0.1",
          caPath: path,
          certPath: path,
          keyPath: path,
        },
      ]),
    );
    const stamp = new Date().toISOString();
    const poll = jest
      .spyOn(PrivateMetadataTransport.prototype, "read")
      .mockResolvedValue({
        schemaVersion: 1,
        instanceId,
        revision: 1,
        sourceAt: stamp,
        observedAt: stamp,
        instance: { instanceId, label: "Remote" },
        tenants: [],
        nextCursor: null,
      });
    await expect(
      bootstrapOperatorRegistryWorker(
        {
          OPERATOR_OBSERVER_ENABLED: "true",
          OPERATOR_COLLECTOR_ENABLED: "true",
          OPERATOR_COLLECTOR_TARGETS_PATH: targetPath,
          LICENSING_INSTANCE_ID: instanceId,
          SUPABASE_URL: "http://127.0.0.1:54321",
          OPERATOR_WORKER_CREDENTIAL_PATH: path,
        },
        [],
        factory,
        sleep,
      ),
    ).rejects.toThrow("test cycle completed");
    expect(log).toHaveBeenCalledWith(
      "Operator observation cycle unavailable\n",
    );
    expect(poll).toHaveBeenCalledTimes(1);
    poll.mockRestore();
  } finally {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  }
});
it("publishes a stable first-page instance and source time while later pages have actual delivery times", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  let calls = 0;
  const values: unknown[] = [];
  const repository = {
    observe: () => {
      const page = calls++;
      const measured = new Date(Date.parse(stamp) + page * 1000).toISOString();
      return Promise.resolve({
        schemaVersion: 1,
        instanceId,
        revision: 1,
        sourceAt: measured,
        observedAt: measured,
        instance: {
          instanceId,
          label: page === 0 ? "First snapshot" : "Changed during pagination",
        },
        tenants: [],
        nextCursor: page === 0 ? "30000000000040008000000000000001" : null,
      });
    },
    publish: (_id: string, publication: unknown) => {
      values.push(publication);
      return Promise.resolve();
    },
  };
  await runOperatorObserver(
    instanceId,
    repository,
    () => Date.parse(stamp) + 5000,
  );
  expect(values).toHaveLength(2);
  expect(values[1]).toMatchObject({
    metadata: {
      sourceAt: stamp,
      observedAt: "2026-01-01T00:00:01.000Z",
      instance: { label: "First snapshot" },
    },
  });
});
it("continues the next page on a later cycle when the local observation budget is exhausted", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  let clock = Date.parse(stamp);
  const afters: (string | null)[] = [];
  let afterId: string | null = null;
  const repository = {
    observe: (_id: string, _time: string, cursor: string | null) => {
      afters.push(cursor);
      const index = cursor ? Number(cursor.slice(-12)) + 1 : 1;
      return Promise.resolve({
        schemaVersion: 1,
        instanceId,
        revision: Date.parse(_time),
        sourceAt: new Date(clock).toISOString(),
        observedAt: new Date(clock).toISOString(),
        instance: { instanceId, label: "Measured local" },
        tenants: [],
        nextCursor:
          index >= 6
            ? null
            : `30000000000040008000${String(index).padStart(12, "0")}`,
      });
    },
    publish: () => {
      clock += 10000;
      return Promise.resolve();
    },
  };
  await runOperatorObserver(instanceId, repository, () => clock, undefined, {
    afterId,
    onProgress: (next) => {
      afterId = next;
    },
  });
  expect(afters.length).toBeGreaterThan(0);
  expect(afters.length).toBeLessThan(6);
  expect(afterId).not.toBeNull();
  const completed = afters.length;
  const retained = afterId;
  await runOperatorObserver(instanceId, repository, () => clock, undefined, {
    afterId,
    onProgress: (next) => {
      afterId = next;
    },
  });
  expect(afters[completed]).toBe(retained);
});
it("restarts a new sweep without stamping unobserved tenants or whole-sweep counts fresh", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  let clock = Date.parse(stamp);
  let afterId: string | null = null;
  const cursors: (string | null)[] = [];
  const pages: unknown[] = [];
  const repository = {
    observe: (_id: string, time: string, cursor: string | null) => {
      cursors.push(cursor);
      const index = cursor ? Number(cursor.slice(-12)) + 1 : 1;
      return Promise.resolve({
        schemaVersion: 1,
        instanceId,
        revision: Date.parse(time),
        sourceAt: new Date(clock).toISOString(),
        observedAt: new Date(clock).toISOString(),
        instance: { instanceId, label: "Current instance sources" },
        tenants: [],
        nextCursor: `30000000000040008000${String(index).padStart(12, "0")}`,
      });
    },
    publish: (_id: string, page: unknown) => {
      pages.push(page);
      clock += 10000;
      return Promise.resolve();
    },
  };
  await runOperatorObserver(instanceId, repository, () => clock, undefined, {
    afterId,
    onProgress: (next) => {
      afterId = next;
    },
  });
  expect(afterId).not.toBeNull();
  const before = cursors.length;
  await runOperatorObserver(instanceId, repository, () => clock);
  expect(cursors[before]).toBeNull();
  expect(pages[before]).toMatchObject({
    metadata: {
      instance: {
        tenantCount: null,
        licenceSummary: { active: null, unknown: null },
      },
      tenants: [],
    },
  });
});
it("retains only published page progress when a later page fails", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  let afterId: string | null = null;
  let calls = 0;
  const repository = {
    observe: () =>
      Promise.resolve({
        schemaVersion: 1,
        instanceId,
        revision: 1,
        sourceAt: stamp,
        observedAt: stamp,
        instance: { instanceId, label: "Local" },
        tenants: [],
        nextCursor: `30000000000040008000${String(++calls).padStart(12, "0")}`,
      }),
    publish: () =>
      calls === 2
        ? Promise.reject(new Error("storage unavailable"))
        : Promise.resolve(),
  };
  await expect(
    runOperatorObserver(
      instanceId,
      repository,
      () => Date.parse(stamp),
      undefined,
      {
        afterId,
        onProgress: (next) => {
          afterId = next;
        },
      },
    ),
  ).rejects.toThrow("storage unavailable");
  expect(afterId).toBe("30000000-0000-4000-8000-000000000001");
});
