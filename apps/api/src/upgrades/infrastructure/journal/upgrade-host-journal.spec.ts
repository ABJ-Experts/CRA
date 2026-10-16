import * as files from "node:fs/promises";
import { chmod, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UpgradeHostJournal } from "./upgrade-host-journal";

jest.mock("node:fs/promises", () => {
  const actual =
    jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, open: jest.fn(actual.open) };
});
describe("authenticated upgrade host journal", () => {
  let root: string;
  const key = Buffer.alloc(32, 7);
  const held = new Set<string>();
  const lock = {
    async run<T>(
      path: string,
      effect: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      if (held.has(path)) throw new Error("locked");
      held.add(path);
      try {
        return await effect(new AbortController().signal);
      } finally {
        held.delete(path);
      }
    },
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "upgrade-journal-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const command = {
    expectedVersion: 0,
    idempotencyKey: "request-1",
    runId: "run-1",
    kind: "intent",
    data: { phase: "drain" },
  };
  const journal = () =>
    new UpgradeHostJournal({
      root,
      key,
      lock,
      instanceId: "instance-1",
      minimumSequence: 0,
    });
  it("persists authenticated intent and replays identical command", async () => {
    const result = await journal().append(command);
    expect(result.sequence).toBe(1);
    expect(await journal().append(command)).toEqual(result);
    expect(await journal().read()).toEqual([result]);
  });
  it("rejects conflicts and concurrent writers", async () => {
    await journal().append(command);
    await expect(journal().append({ ...command, data: {} })).rejects.toThrow();
    await expect(
      journal().append({ ...command, idempotencyKey: "other" }),
    ).rejects.toThrow();
    await journal().withExclusive(async () => {
      await expect(
        journal().withExclusive(() => Promise.resolve(1)),
      ).rejects.toThrow();
    });
    expect(await journal().withExclusive(() => Promise.resolve(2))).toBe(2);
  });
  it("fails closed on corruption, truncation, rollback and wrong keys", async () => {
    await journal().append(command);
    await expect(
      new UpgradeHostJournal({
        root,
        lock,
        key: Buffer.alloc(32, 8),
        instanceId: "instance-1",
        minimumSequence: 0,
      }).read(),
    ).rejects.toThrow();
    await expect(
      new UpgradeHostJournal({
        root,
        key,
        lock,
        instanceId: "instance-1",
        minimumSequence: 2,
      }).read(),
    ).rejects.toThrow();
    const path = join(root, "000000000001.json");
    const raw = await readFile(path, "utf8");
    await writeFile(path, raw.replace("drain", "other"));
    await expect(journal().read()).rejects.toThrow();
    await rm(path);
    await expect(journal().read()).rejects.toThrow();
  });
  it("repairs exactly one authenticated durable tail after interrupted head publication", async () => {
    await journal().append(command);
    const head = await readFile(join(root, "current.json"));
    await journal().append({
      ...command,
      expectedVersion: 1,
      idempotencyKey: "second",
    });
    await writeFile(join(root, "current.json"), head);
    expect(await journal().read()).toHaveLength(2);
    expect(await journal().readPage(1, 1)).toHaveLength(1);
    await expect(journal().readPage(-1, 101)).rejects.toThrow();
  });
  it("recovers first record publication and rejects malformed configuration/input", async () => {
    await journal().append(command);
    await rm(join(root, "current.json"));
    expect(await journal().read()).toHaveLength(1);
    expect(
      () =>
        new UpgradeHostJournal({
          root,
          key: Buffer.alloc(1),
          instanceId: "instance-1",
          minimumSequence: 0,
          lock,
        }),
    ).toThrow();
    await expect(
      journal().append({ ...command, kind: "bad/path" }),
    ).rejects.toThrow();
    await expect(
      journal().append({
        ...command,
        expectedVersion: 1,
        idempotencyKey: "large",
        data: { bytes: "x".repeat(128 * 1024) },
      }),
    ).rejects.toThrow();
    await writeFile(join(root, "current.json"), "[]");
    await expect(journal().read()).rejects.toThrow();
  });
  it("rejects unknown record sequence and unsafe roots", async () => {
    await writeFile(join(root, "000000000002.json"), "{}");
    await expect(journal().read()).rejects.toThrow();
    await rm(join(root, "000000000002.json"));
    await chmod(root, 0o755);
    await expect(journal().read()).rejects.toThrow();
  });
  it("ignores uncommitted partial temporary record after a crash", async () => {
    await journal().append(command);
    await writeFile(join(root, "record-abandoned.tmp"), '{"sequence":2');
    expect(await journal().read()).toHaveLength(1);
    await expect(
      journal().append({
        ...command,
        expectedVersion: 1,
        idempotencyKey: "second",
      }),
    ).resolves.toMatchObject({ sequence: 2 });
  });
  it("never exposes a torn final record when writing the temporary file fails", async () => {
    await journal().append(command);
    const original =
      jest.requireActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      ).open;
    const spy = files.open as jest.MockedFunction<typeof files.open>;
    spy.mockImplementation(async (...args) => {
      const fd = await original(...args);
      if (String(args[0]).includes("record-")) {
        const write = fd.writeFile.bind(fd);
        jest.spyOn(fd, "writeFile").mockImplementation(async () => {
          await write('{"sequence":2');
          throw new Error("ENOSPC");
        });
      }
      return fd;
    });
    try {
      await expect(
        journal().append({
          ...command,
          expectedVersion: 1,
          idempotencyKey: "second",
        }),
      ).rejects.toThrow("ENOSPC");
    } finally {
      spy.mockImplementation(original);
    }
    expect(await journal().read()).toHaveLength(1);
    expect((await files.readdir(root)).includes("000000000002.json")).toBe(
      false,
    );
    await expect(
      journal().append({
        ...command,
        expectedVersion: 1,
        idempotencyKey: "second",
      }),
    ).resolves.toMatchObject({ sequence: 2 });
  });
});
