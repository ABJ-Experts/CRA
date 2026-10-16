import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyRecoveryHistory } from "./recovery-historical-checks";
import { fixture } from "./native-recovery-test.fixture";
import { RECOVERY_OBJECT_METADATA_SQL } from "./restore-inventory";
describe("independent historical restoration checks", () => {
  it("checks every ordered object and preserves preceding successes on a later integrity failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "m15-05-history-"));
    try {
      const f = fixture();
      const objects = ["z", "a"].map((name) => ({
        bucketId: "bucket",
        name,
        version: null,
        entry: `objects/${name}`,
        sha256: createHash("sha256").update(name).digest("hex"),
        bytes: 1,
      }));
      await mkdir(join(root, "stub/stub/bucket"), { recursive: true });
      for (const object of objects)
        await writeFile(
          join(root, "stub/stub/bucket", object.name),
          object.name,
        );
      const recovery = {
        ...f.recovery,
        inventory: { ...f.recovery.inventory, objects },
      };
      const metadata = objects
        .map(({ bucketId, name, version, bytes }) => ({
          bucketId,
          name,
          version,
          bytes,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const sql = (query: string) =>
        query === RECOVERY_OBJECT_METADATA_SQL
          ? Promise.resolve(JSON.stringify(metadata))
          : f.sql(query);
      const options = {
        sql,
        objectDirectory: root,
        prefix: "stub/stub",
        verifyObjectVolume: jest.fn(() => Promise.resolve()),
        externalKeyProbe: () => Promise.resolve(true),
        signal: new AbortController().signal,
      };
      expect(await verifyRecoveryHistory(recovery, options)).toHaveLength(7);
      expect(options.verifyObjectVolume).toHaveBeenCalledTimes(1);
      await writeFile(join(root, "stub/stub/bucket/a"), "corrupt");
      await expect(
        verifyRecoveryHistory(recovery, options),
      ).rejects.toMatchObject({
        failedCheck: "object_integrity",
        completedChecks: expect.arrayContaining([
          "schema_migrations",
          "audit_continuity",
        ]) as unknown,
      });
      await expect(
        verifyRecoveryHistory(recovery, {
          ...options,
          sql: (query) =>
            query.includes("json_agg(datname")
              ? Promise.resolve("[]")
              : sql(query),
        }),
      ).rejects.toMatchObject({
        failedCheck: "schema_migrations",
        completedChecks: [],
      });
      await expect(
        verifyRecoveryHistory(recovery, {
          ...options,
          sql: (query) =>
            query === RECOVERY_OBJECT_METADATA_SQL
              ? Promise.resolve("[]")
              : sql(query),
        }),
      ).rejects.toMatchObject({ failedCheck: "object_integrity" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
