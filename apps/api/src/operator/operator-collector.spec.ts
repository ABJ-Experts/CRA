import {
  OperatorCollector,
  canonicalJson,
  validateSourcePage,
} from "./operator-collector";
const instanceId = "20000000-0000-4000-8000-000000000001";
const stamp = "2026-01-01T00:00:00.000Z";
const page = {
  schemaVersion: 1,
  instanceId,
  revision: 1,
  sourceAt: stamp,
  observedAt: stamp,
  instance: { instanceId, label: "Private" },
  tenants: [],
  nextCursor: null,
};
describe("bounded fair operator collector", () => {
  it("rejects wrong bindings, future, reversed timestamps and content fields", () => {
    expect(
      validateSourcePage(page, instanceId, Date.parse(stamp)),
    ).toMatchObject({ instanceId });
    for (const data of [
      { ...page, instanceId: "30000000-0000-4000-8000-000000000001" },
      { ...page, sourceAt: "2040-01-01T00:00:00.000Z" },
      { ...page, sourceAt: "2026-01-02T00:00:00.000Z" },
      { ...page, content: "secret" },
    ])
      expect(() =>
        validateSourcePage(data, instanceId, Date.parse(stamp)),
      ).toThrow();
  });
  it("canonicalizes publication digests independently of object insertion order", () => {
    expect(canonicalJson({ z: [{ y: 2, x: 1 }], a: 0 })).toBe(
      '{"a":0,"z":[{"x":1,"y":2}]}',
    );
  });
  it("limits concurrency to four, rotates fair starts and does not overlap", async () => {
    let active = 0,
      max = 0;
    const starts: string[] = [];
    let unblock!: () => void;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const transport = {
      read: async (target: { instanceId: string }) => {
        starts.push(target.instanceId);
        active++;
        max = Math.max(max, active);
        await gate;
        active--;
        return {
          ...page,
          instanceId: target.instanceId,
          instance: { ...page.instance, instanceId: target.instanceId },
        };
      },
    };
    const store = {
      publish: jest.fn().mockResolvedValue(undefined),
      failure: jest.fn().mockResolvedValue(undefined),
    };
    const targets = Array.from({ length: 7 }, (_, index) => ({
      instanceId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      endpoint: "https://127.0.0.1",
      ca: Buffer.alloc(0),
      cert: Buffer.alloc(0),
      key: Buffer.alloc(0),
    }));
    let now = Date.parse(stamp);
    const collector = new OperatorCollector(
      targets,
      transport,
      store,
      () => now,
    );
    const first = collector.runOnce();
    await new Promise((resolve) => setImmediate(resolve));
    expect(max).toBe(4);
    expect(await collector.runOnce()).toBe(false);
    unblock();
    await first;
    expect(store.publish).toHaveBeenCalledTimes(7);
    now += 61000;
    await collector.runOnce();
    expect(starts[7]).not.toBe(starts[0]);
  });
  it("records failure without replacing retained successful timestamps", async () => {
    const store = {
      publish: jest.fn(),
      failure: jest.fn().mockResolvedValue(undefined),
    };
    const target = {
      instanceId,
      endpoint: "https://127.0.0.1",
      ca: Buffer.alloc(0),
      cert: Buffer.alloc(0),
      key: Buffer.alloc(0),
    };
    const collector = new OperatorCollector(
      [target],
      {
        read: () => {
          return Promise.reject(new Error("offline secret"));
        },
      },
      store,
      () => Date.parse(stamp),
    );
    await collector.runOnce();
    expect(store.publish).not.toHaveBeenCalled();
    expect(store.failure).toHaveBeenCalledWith(
      instanceId,
      stamp,
      "collection_unreachable",
    );
  });
  it("rejects repeated/out-of-order pages before publication", async () => {
    const store = {
      publish: jest.fn().mockResolvedValue(undefined),
      failure: jest.fn().mockResolvedValue(undefined),
    };
    let attempt = 0;
    const target = {
      instanceId,
      endpoint: "https://127.0.0.1",
      ca: Buffer.alloc(0),
      cert: Buffer.alloc(0),
      key: Buffer.alloc(0),
    };
    const collector = new OperatorCollector(
      [target],
      {
        read: () =>
          Promise.resolve({
            ...page,
            revision: attempt++ === 0 ? 2 : 1,
            nextCursor: "abc",
          }),
      },
      store,
      () => Date.parse(stamp),
    );
    await collector.runOnce();
    expect(store.publish).toHaveBeenCalledTimes(1);
    expect(store.failure).toHaveBeenCalled();
  });
});
it("keeps a cycle locked until every in-flight request settles when storage fails", async () => {
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const targets = [1, 2].map((index) => ({
    instanceId: `20000000-0000-4000-8000-00000000000${index}`,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
  }));
  const transport = {
    read: async (target: { instanceId: string }) => {
      if (target.instanceId.endsWith("1")) throw new Error("offline");
      await gate;
      return {
        ...page,
        instanceId: target.instanceId,
        instance: { ...page.instance, instanceId: target.instanceId },
      };
    },
  };
  const collector = new OperatorCollector(
    targets,
    transport,
    {
      publish: () => Promise.resolve(),
      failure: () => Promise.reject(new Error("private database unavailable")),
    },
    () => Date.parse(stamp),
  );
  const first = collector.runOnce();
  void first.catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  expect(await collector.runOnce()).toBe(false);
  unblock();
  await expect(first).rejects.toThrow("Operator collector storage unavailable");
});
it("collects a 100-page instance no more often than its explicit 60-second cadence", async () => {
  let clock = Date.parse(stamp);
  let requests = 0;
  const target = {
    instanceId,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
    cadenceSeconds: 60,
  };
  const transport = {
    read: (_target: unknown, cursor: string | null) => {
      requests++;
      const index = cursor ? Number(cursor.slice(1)) : 0;
      return Promise.resolve({
        ...page,
        nextCursor: index === 99 ? null : `p${index + 1}`,
      });
    },
  };
  const collector = new OperatorCollector(
    [target],
    transport,
    { publish: () => Promise.resolve(), failure: () => Promise.resolve() },
    () => clock,
  );
  await collector.runOnce();
  expect(requests).toBe(100);
  clock += 30000;
  await collector.runOnce();
  expect(requests).toBe(100);
  clock += 30001;
  await collector.runOnce();
  expect(requests).toBe(200);
});
it("backs off a rate-limited source and preserves the behavior across a collector restart", async () => {
  let clock = Date.parse(stamp);
  const transport = {
    read: jest.fn().mockRejectedValue(new Error("HTTP 429")),
  };
  const publisher = {
    publish: jest.fn(),
    failure: jest.fn().mockResolvedValue(undefined),
  };
  const target = {
    instanceId,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
    cadenceSeconds: 60,
  };
  const collector = new OperatorCollector(
    [target],
    transport,
    publisher,
    () => clock,
  );
  await collector.runOnce();
  clock += 30000;
  await collector.runOnce();
  expect(transport.read).toHaveBeenCalledTimes(1);
  expect(publisher.publish).not.toHaveBeenCalled();
  await new OperatorCollector(
    [target],
    transport,
    publisher,
    () => clock,
  ).runOnce();
  expect(publisher.failure).toHaveBeenCalledTimes(2);
  expect(publisher.publish).not.toHaveBeenCalled();
});
it("cancels a live cycle and does not publish a late successful result", async () => {
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const publisher = {
    publish: jest.fn(),
    failure: jest.fn().mockResolvedValue(undefined),
  };
  const target = {
    instanceId,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
  };
  const collector = new OperatorCollector(
    [target],
    {
      read: async () => {
        await gate;
        return page;
      },
    },
    publisher,
    () => Date.parse(stamp),
  );
  const cycle = collector.runOnce(controller.signal);
  controller.abort();
  release();
  await cycle;
  expect(publisher.publish).not.toHaveBeenCalled();
});
it("resumes fair targets after the bounded cycle instead of restarting its first batch", async () => {
  let clock = Date.parse(stamp);
  const starts: string[] = [];
  let advanced = false;
  const targets = Array.from({ length: 7 }, (_, index) => ({
    instanceId: `20000000-0000-4000-8000-00000000000${index + 1}`,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
  }));
  const collector = new OperatorCollector(
    targets,
    {
      read: async (target) => {
        starts.push(target.instanceId);
        await Promise.resolve();
        if (!advanced) {
          advanced = true;
          clock += 20000;
        }
        return Promise.resolve({
          ...page,
          instanceId: target.instanceId,
          instance: { ...page.instance, instanceId: target.instanceId },
        });
      },
    },
    { publish: () => Promise.resolve(), failure: () => Promise.resolve() },
    () => clock,
  );
  await collector.runOnce();
  expect(starts).toHaveLength(4);
  await collector.runOnce();
  expect(starts[4]).toBe(targets[4]!.instanceId);
  expect(new Set(starts).size).toBe(7);
});

it("reaches slow-instance tail across cycle budgets after accepted pages", async () => {
  let clock = Date.parse(stamp);
  const cursors: (string | null)[] = [];
  const publisher = {
    publish: jest.fn().mockResolvedValue(undefined),
    failure: jest.fn().mockResolvedValue(undefined),
  };
  const target = {
    instanceId,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
  };
  const collector = new OperatorCollector(
    [target],
    {
      read: (_target, cursor) => {
        cursors.push(cursor);
        clock += 3000;
        const index = cursor ? Number(cursor.slice(1)) : 0;
        return Promise.resolve({
          ...page,
          nextCursor: index === 17 ? null : `p${index + 1}`,
        });
      },
    },
    publisher,
    () => clock,
  );
  for (let cycle = 0; cycle < 3; cycle++) {
    await collector.runOnce();
    clock += 60001;
  }
  expect(cursors).toEqual([
    null,
    ...Array.from({ length: 17 }, (_, index) => `p${index + 1}`),
  ]);
  expect(publisher.publish).toHaveBeenCalledTimes(18);
  expect(publisher.failure).not.toHaveBeenCalled();
});
it("clears stale continuation after a source revision conflict", async () => {
  let clock = Date.parse(stamp);
  const cursors: (string | null)[] = [];
  let revision = 1;
  const target = {
    instanceId,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
  };
  const publisher = {
    publish: jest.fn().mockResolvedValue(undefined),
    failure: jest.fn().mockResolvedValue(undefined),
  };
  const collector = new OperatorCollector(
    [target],
    {
      read: (_target, cursor) => {
        cursors.push(cursor);
        clock += 20000;
        return Promise.resolve({ ...page, revision, nextCursor: "p1" });
      },
    },
    publisher,
    () => clock,
  );
  await collector.runOnce();
  clock += 60001;
  revision = 2;
  await collector.runOnce();
  clock += 60001;
  await collector.runOnce();
  expect(cursors).toEqual([null, "p1", null]);
  expect(publisher.publish).toHaveBeenCalledTimes(2);
  expect(publisher.failure).toHaveBeenCalledTimes(1);
});

it("continues a retained cursor when the source publishes a newer monotonic baseline", async () => {
  let clock = Date.parse(stamp);
  const cursors: (string | null)[] = [];
  const revisions = [1, 2, 3];
  const target = {
    instanceId,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
  };
  const publisher = {
    publish: jest.fn().mockResolvedValue(undefined),
    failure: jest.fn().mockResolvedValue(undefined),
  };
  const collector = new OperatorCollector(
    [target],
    {
      read: (_target, cursor) => {
        cursors.push(cursor);
        const index = cursor ? Number(cursor.slice(1)) : 0;
        const sourceAt = new Date(
          Date.parse(stamp) + index * 1000,
        ).toISOString();
        clock += 20000;
        return Promise.resolve({
          ...page,
          revision: revisions[index],
          sourceAt,
          observedAt: sourceAt,
          nextCursor: index === 2 ? null : `p${index + 1}`,
        });
      },
    },
    publisher,
    () => clock,
  );
  for (let cycle = 0; cycle < 3; cycle++) {
    await collector.runOnce();
    clock += 60001;
  }
  expect(cursors).toEqual([null, "p1", "p2"]);
  expect(publisher.publish).toHaveBeenCalledTimes(3);
  expect(publisher.failure).not.toHaveBeenCalled();
});

it.each([
  ["revision rollback", 1, "2026-01-01T00:00:02.000Z"],
  ["source time rollback", 3, stamp],
  ["changed time under the same revision", 2, "2026-01-01T00:00:02.000Z"],
])(
  "rejects %s without publishing the contradictory page",
  async (_reason, revision, sourceAt) => {
    let clock = Date.parse(stamp) + 60_000;
    const cursors: (string | null)[] = [];
    const publications: unknown[] = [];
    const failures: string[] = [];
    const collector = new OperatorCollector(
      [
        {
          instanceId,
          endpoint: "https://127.0.0.1",
          ca: Buffer.alloc(0),
          cert: Buffer.alloc(0),
          key: Buffer.alloc(0),
        },
      ],
      {
        read: (_target, cursor) => {
          cursors.push(cursor);
          const source = cursor
            ? { revision, sourceAt, nextCursor: null }
            : {
                revision: 2,
                sourceAt: "2026-01-01T00:00:01.000Z",
                nextCursor: "p1",
              };
          return Promise.resolve({
            ...page,
            ...source,
            observedAt: source.sourceAt,
          });
        },
      },
      {
        publish: (_instance, publication) => {
          publications.push(publication);
          return Promise.resolve();
        },
        failure: (_instance, _attemptedAt, reason) => {
          failures.push(reason);
          return Promise.resolve();
        },
      },
      () => clock,
    );
    await collector.runOnce();
    expect(publications).toHaveLength(1);
    expect(failures).toEqual(["collection_unreachable"]);
    clock += 60_001;
    await collector.runOnce();
    expect(cursors).toEqual([null, "p1", null, "p1"]);
    expect(publications).toHaveLength(2);
  },
);

it("keeps accepted cursor progress through cancellation without publishing the late page", async () => {
  let clock = Date.parse(stamp);
  const cancellation = new AbortController();
  const cursors: (string | null)[] = [];
  let cancel = true;
  const publisher = {
    publish: jest.fn().mockResolvedValue(undefined),
    failure: jest.fn().mockResolvedValue(undefined),
  };
  const target = {
    instanceId,
    endpoint: "https://127.0.0.1",
    ca: Buffer.alloc(0),
    cert: Buffer.alloc(0),
    key: Buffer.alloc(0),
  };
  const collector = new OperatorCollector(
    [target],
    {
      read: (_target, cursor) => {
        cursors.push(cursor);
        if (cursor && cancel) {
          cancellation.abort();
          cancel = false;
        }
        return Promise.resolve({ ...page, nextCursor: cursor ? null : "p1" });
      },
    },
    publisher,
    () => clock,
  );
  await collector.runOnce(cancellation.signal);
  expect(publisher.publish).toHaveBeenCalledTimes(1);
  clock += 60001;
  await collector.runOnce();
  expect(cursors).toEqual([null, "p1", "p1"]);
  expect(publisher.publish).toHaveBeenCalledTimes(2);
});
