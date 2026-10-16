import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapOperator } from "./operator-main";
it("disabled operator entrypoint does not create or listen", async () => {
  const create = jest.fn();
  expect(await bootstrapOperator({}, create)).toBeNull();
  expect(create).not.toHaveBeenCalled();
});
it("enabled entrypoint binds one explicit private listener with narrow mounted credential", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-entry-"));
  try {
    const path = join(directory, "mounted");
    await writeFile(
      path,
      `e30.${Buffer.from(JSON.stringify({ role: "cra_operator_registry_reader" })).toString("base64url")}.signature`,
      { mode: 0o600 },
    );
    const app = {
      enableShutdownHooks: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
    };
    const create = jest.fn().mockResolvedValue(app);
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
    expect(await bootstrapOperator(env, create)).toBe(app);
    expect(app.listen).toHaveBeenCalledWith(3444, "127.0.0.1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("defaults to the disabled process configuration and default composition factory", async () => {
  const saved = process.env.OPERATOR_ENABLED;
  process.env.OPERATOR_ENABLED = "false";
  try {
    expect(await bootstrapOperator()).toBeNull();
  } finally {
    if (saved === undefined) delete process.env.OPERATOR_ENABLED;
    else process.env.OPERATOR_ENABLED = saved;
  }
});
