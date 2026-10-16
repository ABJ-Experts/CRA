import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiagnosticArtifactStore } from "./diagnostic-artifact.store";
import { diagnosticDigest } from "./diagnostic-archive";
const org = "11111111-1111-4111-8111-111111111111",
  job = "22222222-2222-4222-8222-222222222222";
describe("private diagnostic storage", () => {
  it("scopes paths, uses immutable upload and verifies download integrity", async () => {
    const bytes = Buffer.from("safe");
    const path = `${org}/${job}/attempt-1/bundle.zip`;
    const upload = jest.fn().mockResolvedValue({ error: null });
    const download = jest.fn().mockReturnValue({
      asStream: () =>
        Promise.resolve({
          data: new ReadableStream({
            start(c) {
              c.enqueue(bytes);
              c.close();
            },
          }),
          error: null,
        }),
    });
    const storage = {
      from: jest.fn().mockReturnValue({
        upload,
        download,
        remove: jest.fn().mockResolvedValue({ error: null }),
      }),
    };
    const store = new DiagnosticArtifactStore({
      adminWithSignal: () => ({ storage }),
    } as never);
    await store.put(org, path, bytes);
    expect(upload).toHaveBeenCalledWith(path, bytes, {
      contentType: "application/zip",
      upsert: false,
    });
    expect(
      await store.read(org, path, {
        sha256: diagnosticDigest(bytes),
        byteSize: bytes.length,
      }),
    ).toEqual(bytes);
    await expect(
      store.read(org, path, { sha256: "0".repeat(64), byteSize: bytes.length }),
    ).rejects.toThrow("artifact_integrity");
    await expect(
      store.read("33333333-3333-4333-8333-333333333333", path),
    ).rejects.toThrow();
    expect(storage.from).toHaveBeenCalledWith("support-diagnostics");
  });
  it("rejects oversize and traversal before provider access", async () => {
    const admin = jest.fn();
    const store = new DiagnosticArtifactStore({
      adminWithSignal: admin,
    } as never);
    await expect(store.put(org, "../evil", Buffer.from("x"))).rejects.toThrow();
    await expect(
      store.put(
        org,
        `${org}/${job}/attempt-1/bundle.zip`,
        Buffer.alloc(10485761),
      ),
    ).rejects.toThrow();
    expect(admin).not.toHaveBeenCalled();
  });
});

it("rejects missing, oversized, short and unavailable artifacts and cleans spool files", async () => {
  const path = `${org}/${job}/attempt-1/bundle.zip`;
  const remove = jest.fn().mockResolvedValue({ error: null });
  const upload = jest.fn().mockResolvedValue({ error: { message: "secret" } });
  let response: unknown = { data: null, error: { message: "secret" } };
  const storage = {
    from: () => ({
      upload,
      remove,
      download: () => ({ asStream: () => Promise.resolve(response) }),
    }),
  };
  const store = new DiagnosticArtifactStore({
    adminWithSignal: () => ({ storage }),
  } as never);
  await expect(store.read(org, path)).rejects.toThrow("storage_unavailable");
  await expect(
    store.read(org, path, { sha256: "bad", byteSize: 1 }),
  ).rejects.toThrow("artifact_integrity");
  response = {
    data: new ReadableStream({
      start(c) {
        c.enqueue(Buffer.from("too big"));
        c.close();
      },
    }),
    error: null,
  };
  await expect(
    store.read(org, path, { sha256: "a".repeat(64), byteSize: 1 }),
  ).rejects.toThrow("artifact_integrity");
  await expect(store.put(org, path, Buffer.from("safe"))).rejects.toThrow(
    "storage_unavailable",
  );
  await store.remove(org, path);
  expect(remove).toHaveBeenCalledWith([path]);
  remove.mockResolvedValue({ error: { message: "secret" } });
  await expect(store.remove(org, path)).rejects.toThrow("storage_unavailable");
});

it("reconciles only old private spool directories with the owned fixed file", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "diagnostic-test-"));
  try {
    const old = join(root, "cra-diagnostic-Abc123"),
      fresh = join(root, "cra-diagnostic-Xyz123"),
      foreign = join(root, "unrelated-Abc123");
    for (const path of [old, fresh, foreign]) {
      await fs.mkdir(path, { mode: 0o700 });
      await fs.writeFile(join(path, "bundle.zip"), "redacted", { mode: 0o600 });
    }
    const previous = new Date(Date.now() - 7_200_000);
    await fs.utimes(old, previous, previous);
    await fs.utimes(foreign, previous, previous);
    const store = new DiagnosticArtifactStore({} as never, root);
    await store.reconcileTemporaryFiles();
    await expect(fs.stat(old)).rejects.toThrow();
    expect((await fs.stat(fresh)).isDirectory()).toBe(true);
    expect((await fs.stat(foreign)).isDirectory()).toBe(true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
