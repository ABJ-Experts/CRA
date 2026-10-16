/* eslint-disable @typescript-eslint/unbound-method -- Native process test doubles are asserted as mocks. */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeDockerRecoveryTarget } from "./native-docker-recovery.adapter";
import { fixture, profile } from "./native-recovery-test.fixture";

describe("interrupted recovery provisioning acknowledgement", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "m15-05-provision-test-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("removes only its labelled network when creation succeeds but the client acknowledgement is lost", async () => {
    const f = fixture();
    const original = jest.mocked(f.process.run).getMockImplementation()!;
    jest.mocked(f.process.run).mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1][0] === "network" && args[1][1] === "create")
        throw new Error("acknowledgement interrupted");
      return result;
    });
    await expect(
      NativeDockerRecoveryTarget.create(
        root,
        profile,
        [],
        f.process,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow();
    expect(
      f.observed.some((args) => args[0] === "network" && args[1] === "rm"),
    ).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });
  it("removes only its labelled container when detached launch succeeds but acknowledgement is lost", async () => {
    const f = fixture();
    const target = await NativeDockerRecoveryTarget.create(
      root,
      profile,
      [],
      f.process,
      AbortSignal.timeout(1000),
    );
    const original = jest.mocked(f.process.run).getMockImplementation()!;
    jest.mocked(f.process.run).mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1][0] === "run" && args[1].includes("--detach"))
        throw new Error("acknowledgement interrupted");
      return result;
    });
    await expect(
      target.restore(f.recovery, AbortSignal.timeout(1000)),
    ).rejects.toThrow();
    await target.destroy();
    expect(
      f.observed.some((args) => args[0] === "rm" && args[1] === "--force"),
    ).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });
});
