import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSiemFixtureKeyring } from "./siem-fixture-keyring";
describe("SIEM browser fixture persistent encryption key", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cra-siem-keyring-test-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("retains the same key material across restarts", async () => {
    const path = join(directory, "keyring.json");
    const first = await loadSiemFixtureKeyring(path);
    const second = await loadSiemFixtureKeyring(path);
    expect(second).toBe(first);
    expect(await readFile(path, "utf8")).toBe(first);
  });
  it("never replaces an invalid existing file", async () => {
    const path = join(directory, "keyring.json");
    await writeFile(path, "invalid", { mode: 0o600 });
    await expect(loadSiemFixtureKeyring(path)).rejects.toThrow(
      "Invalid SIEM fixture keyring",
    );
    expect(await readFile(path, "utf8")).toBe("invalid");
  });
  it("validates format and key lengths without exposing material", async () => {
    const path = join(directory, "keyring.json");
    const body = JSON.stringify({
      activeKeyId: "siem-browser-fixture",
      keys: { "siem-browser-fixture": "CANARY" },
    });
    await writeFile(path, body, { mode: 0o600 });
    await expect(loadSiemFixtureKeyring(path)).rejects.toThrow(
      "Invalid SIEM fixture keyring",
    );
    expect(await readFile(path, "utf8")).toBe(body);
  });
  it("exclusive concurrent creation yields one retained key", async () => {
    const path = join(directory, "keyring.json");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => loadSiemFixtureKeyring(path)),
    );
    expect(new Set(results).size).toBe(1);
  });
});
