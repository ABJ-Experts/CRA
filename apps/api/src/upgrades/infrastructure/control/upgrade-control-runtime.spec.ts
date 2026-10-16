import { loadUpgradeControlRuntime } from "./upgrade-control-runtime";
describe("optional upgrade operator control", () => {
  it("is absent without mounts", async () =>
    expect(await loadUpgradeControlRuntime({})).toBeUndefined());
  it("rejects partial mounts", async () => {
    await expect(
      loadUpgradeControlRuntime({
        UPGRADE_CONTROL_SOCKET_PATH: "/run/control.sock",
      }),
    ).rejects.toThrow();
    await expect(
      loadUpgradeControlRuntime({ UPGRADE_CONTROL_KEY_PATH: "/run/key" }),
    ).rejects.toThrow();
  });
});
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
it("constructs control only with complete private configuration", async () => {
  const root = await mkdtemp(join(tmpdir(), "upgrade-control-"));
  try {
    const key = join(root, "key");
    await writeFile(key, Buffer.alloc(32, 1), { mode: 0o600 });
    expect(
      await loadUpgradeControlRuntime({
        UPGRADE_CONTROL_SOCKET_PATH: join(root, "socket"),
        UPGRADE_CONTROL_KEY_PATH: key,
        LICENSING_INSTANCE_ID: randomUUID(),
      }),
    ).toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
