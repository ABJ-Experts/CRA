import { constants } from "node:fs";
import {
  chmod,
  mkdtemp,
  open,
  rm,
  opendir,
  lstat,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupabaseService } from "../../supabase/supabase.service";
import { diagnosticDigest } from "./diagnostic-archive";
const MAX = 10485760;
export class DiagnosticArtifactStore {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly scratchRoot: string = tmpdir(),
  ) {}
  /** Local crash leftovers only; retained storage objects require a reviewed DB claim. */
  async reconcileTemporaryFiles(): Promise<void> {
    const directory = await opendir(this.scratchRoot);
    let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > 1000) break;
      if (
        !/^cra-diagnostic-[A-Za-z0-9]{6}$/.test(entry.name) ||
        !entry.isDirectory()
      )
        continue;
      const path = join(this.scratchRoot, entry.name);
      const info = await lstat(path);
      if (
        !info.isDirectory() ||
        (info.mode & 0o777) !== 0o700 ||
        info.uid !== process.getuid?.() ||
        info.mtimeMs > Date.now() - 3_600_000
      )
        continue;
      const children = await readdir(path);
      if (children.some((name) => name !== "bundle.zip")) continue;
      if (children.length) {
        const file = await lstat(join(path, "bundle.zip"));
        if (
          !file.isFile() ||
          (file.mode & 0o777) !== 0o600 ||
          file.uid !== info.uid
        )
          continue;
      }
      await rm(path, { recursive: true, force: true });
    }
  }
  async put(
    orgId: string,
    objectPath: string,
    bytes: Buffer,
    signal: AbortSignal = AbortSignal.timeout(60_000),
  ): Promise<void> {
    assertPath(orgId, objectPath);
    if (bytes.length < 1 || bytes.length > MAX) throw new Error("bundle_limit");
    const { error } = await this.supabase
      .adminWithSignal(signal)
      .storage.from("support-diagnostics")
      .upload(objectPath, bytes, {
        contentType: "application/zip",
        upsert: false,
      });
    if (error) throw new Error("storage_unavailable");
  }
  async read(
    orgId: string,
    objectPath: string,
    expected?: { sha256: string; byteSize: number },
    signal: AbortSignal = AbortSignal.timeout(60_000),
  ): Promise<Buffer> {
    assertPath(orgId, objectPath);
    if (
      expected &&
      (!/^[a-f0-9]{64}$/.test(expected.sha256) ||
        !Number.isSafeInteger(expected.byteSize) ||
        expected.byteSize < 1 ||
        expected.byteSize > MAX)
    )
      throw new Error("artifact_integrity");
    const directory = await mkdtemp(join(this.scratchRoot, "cra-diagnostic-"));
    await chmod(directory, 0o700);
    try {
      const response = await this.supabase
        .adminWithSignal(signal)
        .storage.from("support-diagnostics")
        .download(objectPath)
        .asStream();
      if (response.error || !response.data)
        throw new Error("storage_unavailable");
      const file = await open(
        join(directory, "bundle.zip"),
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      const reader = (response.data as ReadableStream<Uint8Array>).getReader();
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > (expected?.byteSize ?? MAX))
            throw new Error("artifact_integrity");
          await file.writeFile(next.value);
        }
      } finally {
        await reader.cancel();
        await file.close();
      }
      const readFile = await open(
        join(directory, "bundle.zip"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let bytes: Buffer;
      try {
        bytes = await readFile.readFile();
      } finally {
        await readFile.close();
      }
      if (
        expected &&
        (bytes.length !== expected.byteSize ||
          diagnosticDigest(bytes) !== expected.sha256)
      )
        throw new Error("artifact_integrity");
      return bytes;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  async remove(
    orgId: string,
    objectPath: string,
    signal: AbortSignal = AbortSignal.timeout(60_000),
  ): Promise<void> {
    assertPath(orgId, objectPath);
    const { error } = await this.supabase
      .adminWithSignal(signal)
      .storage.from("support-diagnostics")
      .remove([objectPath]);
    if (error) throw new Error("storage_unavailable");
  }
}
function assertPath(orgId: string, path: string): void {
  if (
    !/^[a-f0-9-]{36}$/.test(orgId) ||
    !new RegExp(`^${orgId}/[a-f0-9-]{36}/attempt-[1-3]/bundle\\.zip$`).test(
      path,
    )
  )
    throw new Error("artifact_integrity");
}
