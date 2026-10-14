import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOperatorRuntime,
  loadWorkerRuntime,
  requiredMountedFile,
} from "./operator-runtime";
describe("opt-in mounted operator configuration", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "operator-runtime-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("stays disabled without opt-in and rejects enabled listener without stable identity", async () => {
    expect(await loadOperatorRuntime({})).toBeNull();
    expect(await loadWorkerRuntime({})).toBeNull();
    await expect(
      loadOperatorRuntime({ OPERATOR_ENABLED: "true" }),
    ).rejects.toThrow();
  });
  it("requires mounted private files accessible only to their owner", async () => {
    const path = join(directory, "key");
    await writeFile(path, "secret", { mode: 0o644 });
    await expect(requiredMountedFile(path, true)).rejects.toThrow();
    await expect(requiredMountedFile(undefined, true)).rejects.toThrow();
  });
  it("loads only explicit TLS mounts, narrow credential and private bind", async () => {
    const path = join(directory, "secret");
    await writeFile(path, "mounted", { mode: 0o600 });
    const env = {
      SUPABASE_ANON_KEY: `e30.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`,
      OPERATOR_ENABLED: "true",
      LICENSING_INSTANCE_ID: "20000000-0000-4000-8000-000000000001",
      OPERATOR_TLS_KEY_PATH: path,
      OPERATOR_TLS_CERT_PATH: path,
      OPERATOR_CA_CERT_PATH: path,
      OPERATOR_GRANTS_PATH: path,
      OPERATOR_DB_CREDENTIAL_PATH: path,
      SUPABASE_URL: "http://127.0.0.1:54321",
    };
    const config = await loadOperatorRuntime(env);
    expect(config?.listener.host).toBe("127.0.0.1");
    expect(config?.credential).toBe("mounted");
    await expect(
      loadOperatorRuntime({ ...env, OPERATOR_HOST: "0.0.0.0" }),
    ).rejects.toThrow();
  });
});
it("loads explicit separate observer/collector credentials and strict unique target mounts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-worker-runtime-"));
  try {
    const path = join(directory, "credential");
    await writeFile(path, "credential", { mode: 0o600 });
    const targets = join(directory, "targets.json");
    const target = {
      instanceId: "30000000-0000-4000-8000-000000000001",
      endpoint: "https://127.0.0.1:3444",
      caPath: path,
      certPath: path,
      keyPath: path,
    };
    await writeFile(targets, JSON.stringify([target]));
    const env = {
      LICENSING_INSTANCE_ID: "20000000-0000-4000-8000-000000000001",
      SUPABASE_URL: "http://127.0.0.1:54321",
      OPERATOR_OBSERVER_ENABLED: "true",
      OPERATOR_COLLECTOR_ENABLED: "true",
      OPERATOR_WORKER_CREDENTIAL_PATH: path,
      OPERATOR_COLLECTOR_TARGETS_PATH: targets,
    };
    const loaded = await loadWorkerRuntime(env);
    expect(loaded?.observeLocal).toBe(true);
    expect(loaded?.targets).toHaveLength(1);
    expect(
      (await loadWorkerRuntime({ ...env, OPERATOR_COLLECTOR_ENABLED: "false" }))
        ?.targets,
    ).toEqual([]);
    await expect(
      loadWorkerRuntime({ ...env, SUPABASE_URL: undefined }),
    ).rejects.toThrow();
    await writeFile(targets, JSON.stringify([target, target]));
    await expect(loadWorkerRuntime(env)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
