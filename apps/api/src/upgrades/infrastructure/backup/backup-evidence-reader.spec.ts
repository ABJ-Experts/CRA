import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NativeBackupEvidenceReader } from "./backup-evidence-reader";
import { NativeBackupProcess } from "../../../backups/infrastructure/capture/native-backup-process";

describe("native backup evidence reader", () => {
  const capture = "11111111-1111-4111-8111-111111111111";
  const child = "22222222-2222-4222-8222-222222222222";
  const digest = "a".repeat(64);
  let root: string;
  const run = jest.fn(() => Promise.resolve('{"valid":true}'));
  const signal = new AbortController().signal;
  const reader = (overrides = {}) =>
    new NativeBackupEvidenceReader(
      {
        instanceId: capture,
        host: "localhost",
        port: 54322,
        database: "postgres",
        user: "backup_reader",
        pgpassFile: join(root, "pgpass"),
        psqlBinary: "/bin/psql",
        ...overrides,
      },
      { run } as unknown as NativeBackupProcess,
    );
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "backup-evidence-"));
    await writeFile(join(root, "pgpass"), "private", { mode: 0o600 });
    run.mockReset().mockResolvedValue('{"valid":true}');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("uses a bounded read-only query bound to exact same-instance capture and fully verified child", async () => {
    await reader().assertVerifiedChild(capture, child, digest, signal);
    const args = run.mock.calls[0] as unknown as [
      string,
      string[],
      AbortSignal,
      string,
      number,
    ];
    expect(args[3]).toContain("BEGIN READ ONLY");
    expect(args[3]).toContain("v.parent_capture_id=c.id");
    expect(args[3]).toContain(`v.id='${child}'`);
    expect(args[3]).toContain(`manifestSha256'='${digest}'`);
    expect(args[3]).toContain("m15_05_verification_valid");
    expect(JSON.stringify(args[1])).not.toContain("private");
    expect(args[4]).toBe(4096);
  });
  it("rejects unsafe configuration/identities before native execution", async () => {
    await expect(
      reader().assertVerifiedChild("'; DROP", child, digest, signal),
    ).rejects.toThrow();
    await expect(
      reader().assertVerifiedChild(capture, child, "bad", signal),
    ).rejects.toThrow();
    await expect(
      reader({ host: "host;bad" }).assertVerifiedChild(
        capture,
        child,
        digest,
        signal,
      ),
    ).rejects.toThrow();
    await chmod(join(root, "pgpass"), 0o644);
    await expect(
      reader().assertVerifiedChild(capture, child, digest, signal),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it("fails closed on unknown or malformed evidence", async () => {
    run.mockResolvedValue('{"valid":false}');
    await expect(
      reader().assertVerifiedChild(capture, child, digest, signal),
    ).rejects.toThrow();
    run.mockResolvedValue("unavailable");
    await expect(
      reader().assertVerifiedChild(capture, child, digest, signal),
    ).rejects.toThrow();
  });
});
