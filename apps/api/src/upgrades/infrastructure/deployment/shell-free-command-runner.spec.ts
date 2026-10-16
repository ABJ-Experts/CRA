import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShellFreeCommandRunner } from "./linux-deployment.adapter";
describe("bounded shell-free native runner", () => {
  const runner = new ShellFreeCommandRunner();
  const options = { cwd: process.cwd(), environment: {} };
  it("passes arguments literally and sends input without shell interpretation", async () => {
    expect(
      await runner.run(
        process.execPath,
        ["-e", "process.stdin.pipe(process.stdout)"],
        { ...options, stdin: "$(echo forbidden); literal\n" },
      ),
    ).toBe("$(echo forbidden); literal\n");
  });
  it("redacts native stderr on failure", async () => {
    await expect(
      runner.run(
        process.execPath,
        ["-e", "process.stderr.write('private password');process.exit(1)"],
        options,
      ),
    ).rejects.toThrow("upgrade_native_failed");
  });
  it("rejects unavailable executable", async () => {
    await expect(
      runner.run("/no/such/executable", [], options),
    ).rejects.toThrow("upgrade_native_unavailable");
  });
  it("bounds stdout", async () => {
    await expect(
      runner.run(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(1100000))"],
        options,
      ),
    ).rejects.toThrow("upgrade_native_failed");
  });
});
it("revokes authority permanently and cancels only owned processes", async () => {
  const runner = new ShellFreeCommandRunner();
  const running = runner.run(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { cwd: process.cwd(), environment: {} },
  );
  runner.abortAll();
  await expect(running).rejects.toThrow("upgrade_native_failed");
  expect(runner.signal.aborted).toBe(true);
  await expect(
    runner.run(process.execPath, ["-e", "process.exit(0)"], {
      cwd: process.cwd(),
      environment: {},
    }),
  ).rejects.toThrow("authority_lost");
});
it("kills an owned native command's descendants on authority loss", async () => {
  const directory = await mkdtemp(join(tmpdir(), "upgrade-descendant-"));
  const runner = new ShellFreeCommandRunner();
  const ready = join(directory, "ready");
  const effect = join(directory, "forbidden-effect");
  const grandchild =
    "require('node:fs').writeFileSync(process.argv[1],'ready');setTimeout(()=>require('node:fs').writeFileSync(process.argv[2],'effect'),800)";
  const parent =
    "require('node:child_process').spawn(process.execPath,['-e',process.argv[1],process.argv[2],process.argv[3]],{stdio:'ignore'});setInterval(()=>{},1000)";
  const running = runner.run(
    process.execPath,
    ["-e", parent, grandchild, ready, effect],
    { cwd: directory, environment: {} },
  );
  const rejected = expect(running).rejects.toThrow("upgrade_native_failed");
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await readFile(ready, "utf8").catch(() => "")) === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(await readFile(ready, "utf8")).toBe("ready");
    runner.abortAll();
    await rejected;
    await new Promise((resolve) => setTimeout(resolve, 900));
    await expect(readFile(effect, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    runner.abortAll();
    await rm(directory, { recursive: true, force: true });
  }
});
