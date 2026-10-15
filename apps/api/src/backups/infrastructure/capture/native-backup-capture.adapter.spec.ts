import {
  NativeBackupCaptureAdapter,
  storageObjectPath,
} from "./native-backup-capture.adapter";
import { BackupCaptureRequest } from "../../application/backup-execution.port";

describe("native capture safety", () => {
  it("refuses traversal and absolute storage identities", () => {
    for (const name of [
      "../secret",
      "/etc/passwd",
      "ok/../../secret",
      "a\\b",
      "a\u0000b",
    ])
      expect(() =>
        storageObjectPath("/mnt", "stub/stub", "evidence", name, "version"),
      ).toThrow("unsafe_object_identity");
    expect(
      storageObjectPath(
        "/mnt",
        "stub/stub",
        "evidence",
        "nested/file.pdf",
        "version",
      ),
    ).toBe("/mnt/stub/stub/evidence/nested/file.pdf/version");
  });
  it("never starts tools for unknown aliases", async () => {
    const executor = new NativeBackupCaptureAdapter({
      sources: {},
      repositories: {},
      staging: {},
      keys: {},
      gpgBinary: "gpg",
    });
    const request = {
      sourceAlias: "unknown",
      repositoryAlias: "unknown",
      stagingAlias: "unknown",
      keyAlias: "unknown",
    } as BackupCaptureRequest;
    await expect(
      executor.capture(request, {
        signal: new AbortController().signal,
        checkpoint: jest.fn(),
        assertAuthority: jest.fn(),
      }),
    ).rejects.toThrow("unknown_mount_alias");
  });
});
