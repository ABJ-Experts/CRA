import { spawn } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import { BackupPartialParts } from "./backup-partial-parts";
import { Readable, Transform, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import {
  BackupCertificate,
  BackupEncryptedPart,
  BackupExecutionError,
  BackupInventory,
  BackupPartKind,
} from "../../application/backup-execution.port";

export interface EncryptedRepositoryConfiguration {
  readonly repository: string;
  readonly keyFile: string;
  readonly keyId: string;
  readonly gpgBinary: string;
  readonly maximumPartBytes: number;
  readonly keyFilesById?: Readonly<Record<string, string>>;
  readonly instanceId?: string;
  readonly trackRunOwnership?: boolean;
}

const identifier = /^[a-f0-9-]{36}$/;
const digest = /^[a-f0-9]{64}$/;
const maximumCertificateManifestBytes = 32 * 1024 * 1024;

export function canonicalBackupJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalBackupJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalBackupJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

export function backupDigest(value: unknown): string {
  return createHash("sha256").update(canonicalBackupJson(value)).digest("hex");
}

/** Every stored part is authenticated OCB ciphertext; temporary output is ciphertext too. */
export class EncryptedBackupRepository {
  private readonly ownership: BackupPartialParts | null;
  async acquirePublicationLease(
    runId: string,
    recoverStale?: (ownerRunId: string) => Promise<boolean>,
  ): Promise<() => Promise<void>> {
    this.requireIdentifier(runId);
    const path = join(this.configuration.repository, ".publication.lock");
    let file;
    try {
      file = await open(path, "wx", 0o600);
    } catch {
      const existing = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let owner: { runId: string; kind: string; pid: number; host: string };
      try {
        if ((await existing.stat()).size > 1024)
          throw new BackupExecutionError("conflict");
        owner = JSON.parse(await existing.readFile("utf8")) as typeof owner;
      } finally {
        await existing.close();
      }
      this.requireIdentifier(owner.runId);
      let dead = false;
      if (
        owner.host === hostname() &&
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0
      )
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          dead = (error as NodeJS.ErrnoException).code === "ESRCH";
        }
      if (
        !dead ||
        owner.kind !== "capture" ||
        !recoverStale ||
        !(await recoverStale(owner.runId))
      )
        throw new BackupExecutionError("conflict");
      await rm(path);
      file = await open(path, "wx", 0o600);
    }
    try {
      await file.writeFile(
        JSON.stringify({
          runId,
          kind: "capture",
          pid: process.pid,
          host: hostname(),
        }),
      );
      await file.sync();
    } catch (error) {
      await file.close();
      await rm(path, { force: true });
      throw error;
    }
    return async () => {
      await file.close();
      await rm(path, { force: true });
    };
  }
  constructor(
    private readonly configuration: EncryptedRepositoryConfiguration,
  ) {
    this.ownership =
      configuration.trackRunOwnership && configuration.instanceId
        ? new BackupPartialParts(
            configuration.repository,
            configuration.instanceId,
            this,
          )
        : null;
  }

  async reconcileUnpublished(
    instanceId: string,
    isAbandoned: (runId: string) => Promise<boolean>,
    signal: AbortSignal,
    publicationLeaseHeld = false,
    publicationOwnerRunId?: string,
  ): Promise<number> {
    return new BackupPartialParts(
      this.configuration.repository,
      instanceId,
      this,
    ).reconcile(
      isAbandoned,
      signal,
      publicationLeaseHeld,
      publicationOwnerRunId,
    );
  }

  partPath(part: Pick<BackupEncryptedPart, "id">): string {
    if (!identifier.test(part.id))
      throw new BackupExecutionError("unsafe_identifier");
    return join(this.configuration.repository, "parts", `${part.id}.gpg`);
  }

  async sealPart(
    runId: string,
    kind: BackupPartKind,
    name: string,
    input: Readable,
    signal: AbortSignal,
  ): Promise<BackupEncryptedPart> {
    this.requireIdentifier(runId);
    signal.throwIfAborted();
    const id = randomUUID();
    const target = this.partPath({ id });
    const temporary = `${target}.partial`;
    await this.prepareRepository();
    await this.ownership?.record(id, runId);
    const key = await this.openKey();
    const plaintext = this.counter(this.configuration.maximumPartBytes);
    const ciphertext = this.counter(
      this.configuration.maximumPartBytes + 1024 * 1024,
    );
    const child = spawn(
      this.configuration.gpgBinary,
      [
        "--homedir",
        join(this.configuration.repository, ".gpg"),
        "--no-options",
        "--batch",
        "--yes",
        "--no-autostart",
        "--no-random-seed-file",
        "--pinentry-mode",
        "loopback",
        "--s2k-count",
        "65011712",
        "--no-symkey-cache",
        "--cipher-algo",
        "AES256",
        "--force-ocb",
        "--symmetric",
        "--passphrase-fd",
        "3",
        "--output",
        "-",
      ],
      { stdio: ["pipe", "pipe", "ignore", key.fd], signal },
    );
    const exited = this.completed(child);
    try {
      await Promise.all([
        pipeline(input, plaintext.stream, child.stdin!, { signal }),
        pipeline(
          child.stdout!,
          ciphertext.stream,
          createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
          { signal },
        ),
        exited,
      ]);
      await this.syncFile(temporary);
      await rename(temporary, target);
      await this.syncDirectory(dirname(target));
      return {
        keyId: this.configuration.keyId,
        id,
        kind,
        name,
        sha256: plaintext.hash.digest("hex"),
        bytes: plaintext.bytes(),
        cipherSha256: ciphertext.hash.digest("hex"),
        cipherBytes: ciphertext.bytes(),
      };
    } catch (error) {
      child.kill("SIGKILL");
      await rm(temporary, { force: true });
      await rm(target, { force: true });
      await this.ownership?.discard([id]);
      if (error instanceof BackupExecutionError) throw error;
      if (signal.aborted) throw new BackupExecutionError("cancelled");
      throw new BackupExecutionError("encryption_failed");
    } finally {
      await key.close();
    }
  }

  async openPart(
    part: BackupEncryptedPart,
    destination: string,
    signal: AbortSignal,
  ): Promise<void> {
    const temporary = `${destination}.${randomUUID()}.partial`;
    const sink = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
    sink.on("error", () => undefined);
    try {
      await this.openPartToSink(part, sink, signal);
      const output = await open(
        destination,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await output.close();
      await rename(temporary, destination);
    } catch (error) {
      sink.destroy();
      await finished(sink).catch(() => undefined);
      await rm(temporary, { force: true });
      if (error instanceof BackupExecutionError) throw error;
      throw new BackupExecutionError(
        signal.aborted ? "cancelled" : "decryption_failed",
      );
    }
  }

  /** Sink must be private staging. Never extract or start a target until this resolves. */
  async openPartToSink(
    part: BackupEncryptedPart,
    sink: Writable,
    signal: AbortSignal,
  ): Promise<void> {
    const source = await this.verifyCiphertext(part, signal);
    const key = await this.openKey(part.keyId ?? this.configuration.keyId);
    const plaintext = this.counter(
      Math.min(this.configuration.maximumPartBytes, part.bytes),
    );
    const child = spawn(
      this.configuration.gpgBinary,
      [
        "--homedir",
        join(this.configuration.repository, ".gpg"),
        "--no-options",
        "--batch",
        "--no-autostart",
        "--no-random-seed-file",
        "--pinentry-mode",
        "loopback",
        "--s2k-count",
        "65011712",
        "--no-symkey-cache",
        "--passphrase-fd",
        "3",
        "--decrypt",
        "--output",
        "-",
      ],
      { stdio: ["pipe", "pipe", "ignore", key.fd], signal },
    );
    const exited = this.completed(child);
    try {
      await Promise.all([
        pipeline(await this.readCipher(source), child.stdin!, { signal }),
        pipeline(child.stdout!, plaintext.stream, sink, { signal }),
        exited,
      ]);
      if (
        plaintext.bytes() !== part.bytes ||
        plaintext.hash.digest("hex") !== part.sha256
      )
        throw new BackupExecutionError("plaintext_integrity");
    } catch (error) {
      child.kill("SIGKILL");
      if (error instanceof BackupExecutionError) throw error;
      throw new BackupExecutionError(
        signal.aborted ? "cancelled" : "decryption_failed",
      );
    } finally {
      await key.close();
    }
  }

  async verifyCiphertext(
    part: BackupEncryptedPart,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    if (
      !Number.isSafeInteger(part.bytes) ||
      part.bytes < 0 ||
      !Number.isSafeInteger(part.cipherBytes) ||
      part.cipherBytes <= 0 ||
      part.bytes > this.configuration.maximumPartBytes ||
      part.cipherBytes > this.configuration.maximumPartBytes + 1024 * 1024
    )
      throw new BackupExecutionError("ciphertext_integrity");
    const source = this.partPath(part);
    const stat = await lstat(source);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size !== part.cipherBytes ||
      !digest.test(part.cipherSha256) ||
      !digest.test(part.sha256)
    )
      throw new BackupExecutionError("ciphertext_integrity");
    const checked = this.counter(
      this.configuration.maximumPartBytes + 1024 * 1024,
    );
    await pipeline(
      await this.readCipher(source),
      checked.stream,
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
      { signal },
    );
    if (checked.hash.digest("hex") !== part.cipherSha256)
      throw new BackupExecutionError("ciphertext_integrity");
    return source;
  }

  async sealCertificate(
    certificate: BackupCertificate,
    inventory: BackupInventory,
    signal: AbortSignal,
  ): Promise<void> {
    this.requireIdentifier(certificate.runId);
    const { certificateDigest, ...unsigned } = certificate;
    if (
      backupDigest(unsigned) !== certificateDigest ||
      backupDigest(inventory) !== certificate.inventoryDigest
    )
      throw new BackupExecutionError("certificate_integrity");
    const manifest = canonicalBackupJson({ certificate, inventory });
    if (Buffer.byteLength(manifest, "utf8") > maximumCertificateManifestBytes)
      throw new BackupExecutionError("insufficient_capacity");
    const part = await this.sealPart(
      certificate.runId,
      "inventory",
      "certificate.json",
      Readable.from([manifest]),
      signal,
    );
    const receipt = join(
      this.configuration.repository,
      "certificates",
      `${certificate.runId}.json`,
    );
    await mkdir(dirname(receipt), { recursive: true, mode: 0o700 });
    const file = await open(receipt, "wx", 0o600);
    try {
      await file.writeFile(canonicalBackupJson({ part, certificateDigest }));
      await file.sync();
    } finally {
      await file.close();
    }
    await this.syncDirectory(dirname(receipt));
    const instances = join(this.configuration.repository, "instances");
    await mkdir(instances, { recursive: true, mode: 0o700 });
    this.requireIdentifier(certificate.instanceId);
    const temporary = join(
      instances,
      `${certificate.instanceId}.${randomUUID()}.partial`,
    );
    const pointer = await open(temporary, "wx", 0o600);
    try {
      await pointer.writeFile(
        canonicalBackupJson({ runId: certificate.runId, certificateDigest }),
      );
      await pointer.sync();
    } finally {
      await pointer.close();
    }
    await rename(temporary, join(instances, `${certificate.instanceId}.json`));
    await this.syncDirectory(instances);
    await this.ownership?.discard([
      ...certificate.parts.map((part) => part.id),
      part.id,
    ]);
  }

  async latestCertificate(
    instanceId: string,
    stagingDirectory: string | null,
    signal: AbortSignal,
  ): Promise<BackupCertificate | null> {
    this.requireIdentifier(instanceId);
    const path = join(
      this.configuration.repository,
      "instances",
      `${instanceId}.json`,
    );
    let pointer: { runId: string; certificateDigest: string };
    try {
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if ((await file.stat()).size > 1024)
          throw new BackupExecutionError("certificate_integrity");
        pointer = JSON.parse(await file.readFile("utf8")) as typeof pointer;
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const certificate =
      stagingDirectory === null
        ? await this.loadCertificateInMemory(pointer.runId, signal)
        : await this.loadCertificate(pointer.runId, stagingDirectory, signal);
    if (
      certificate.instanceId !== instanceId ||
      certificate.certificateDigest !== pointer.certificateDigest
    )
      throw new BackupExecutionError("certificate_integrity");
    return certificate;
  }

  async loadCertificateInMemory(
    parentRunId: string,
    signal: AbortSignal,
  ): Promise<BackupCertificate> {
    this.requireIdentifier(parentRunId);
    const receiptPath = join(
      this.configuration.repository,
      "certificates",
      `${parentRunId}.json`,
    );
    const file = await open(
      receiptPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let receipt: { part: BackupEncryptedPart; certificateDigest: string };
    try {
      if ((await file.stat()).size > 8192)
        throw new BackupExecutionError("certificate_integrity");
      receipt = JSON.parse(await file.readFile("utf8")) as typeof receipt;
    } finally {
      await file.close();
    }
    if (receipt.part.bytes > maximumCertificateManifestBytes)
      throw new BackupExecutionError("certificate_integrity");
    const chunks: Buffer[] = [];
    await this.openPartToSink(
      receipt.part,
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
      }),
      signal,
    );
    const contents = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      certificate: BackupCertificate;
      inventory: BackupInventory;
    };
    const { certificateDigest, ...unsigned } = contents.certificate;
    if (
      contents.certificate.runId !== parentRunId ||
      certificateDigest !== receipt.certificateDigest ||
      backupDigest(unsigned) !== certificateDigest ||
      backupDigest(contents.inventory) !== contents.certificate.inventoryDigest
    )
      throw new BackupExecutionError("certificate_integrity");
    return contents.certificate;
  }

  async openCertificate(
    request: {
      readonly certificate: BackupCertificate;
      readonly parentRunId: string;
    },
    stagingDirectory: string,
    signal: AbortSignal,
  ): Promise<{
    readonly inventory: BackupInventory;
    readonly openPart: (
      part: BackupEncryptedPart,
      destination: string,
      partSignal: AbortSignal,
    ) => Promise<void>;
  }> {
    this.requireIdentifier(request.parentRunId);
    const receiptPath = join(
      this.configuration.repository,
      "certificates",
      `${request.parentRunId}.json`,
    );
    const info = await lstat(receiptPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192)
      throw new BackupExecutionError("certificate_integrity");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
      part: BackupEncryptedPart;
      certificateDigest: string;
    };
    if (receipt.part.bytes > maximumCertificateManifestBytes)
      throw new BackupExecutionError("certificate_integrity");
    const decrypted = join(
      stagingDirectory,
      `certificate-${randomUUID()}.json`,
    );
    await this.openPart(receipt.part, decrypted, signal);
    try {
      const contents = JSON.parse(await readFile(decrypted, "utf8")) as {
        certificate: BackupCertificate;
        inventory: BackupInventory;
      };
      const { certificateDigest, ...unsigned } = contents.certificate;
      if (
        certificateDigest !== receipt.certificateDigest ||
        certificateDigest !== request.certificate.certificateDigest ||
        backupDigest(unsigned) !== certificateDigest ||
        backupDigest(contents.inventory) !==
          contents.certificate.inventoryDigest
      )
        throw new BackupExecutionError("certificate_integrity");
      return {
        inventory: contents.inventory,
        openPart: (part, destination, partSignal) =>
          this.openPart(part, destination, partSignal),
      };
    } finally {
      await rm(decrypted, { force: true });
    }
  }

  async loadCertificate(
    parentRunId: string,
    stagingDirectory: string,
    signal: AbortSignal,
  ): Promise<BackupCertificate> {
    this.requireIdentifier(parentRunId);
    const receiptPath = join(
      this.configuration.repository,
      "certificates",
      `${parentRunId}.json`,
    );
    const info = await lstat(receiptPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 8192)
      throw new BackupExecutionError("certificate_integrity");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
      part: BackupEncryptedPart;
      certificateDigest: string;
    };
    if (receipt.part.bytes > maximumCertificateManifestBytes)
      throw new BackupExecutionError("certificate_integrity");
    const path = join(stagingDirectory, `certificate-${randomUUID()}.json`);
    await this.openPart(receipt.part, path, signal);
    try {
      const contents = JSON.parse(await readFile(path, "utf8")) as {
        certificate: BackupCertificate;
        inventory: BackupInventory;
      };
      const { certificateDigest, ...unsigned } = contents.certificate;
      if (
        contents.certificate.runId !== parentRunId ||
        certificateDigest !== receipt.certificateDigest ||
        backupDigest(unsigned) !== certificateDigest ||
        backupDigest(contents.inventory) !==
          contents.certificate.inventoryDigest
      )
        throw new BackupExecutionError("certificate_integrity");
      return contents.certificate;
    } finally {
      await rm(path, { force: true });
    }
  }

  private requireIdentifier(value: string): void {
    if (!identifier.test(value))
      throw new BackupExecutionError("unsafe_identifier");
  }

  private async openKey(keyId = this.configuration.keyId) {
    const path =
      keyId === this.configuration.keyId
        ? this.configuration.keyFile
        : this.configuration.keyFilesById?.[keyId];
    if (!path) throw new BackupExecutionError("historical_key_unavailable");
    const canonicalPath = await realpath(path);
    const canonicalRepository = await realpath(this.configuration.repository);
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size < 16 ||
      stat.size > 4096 ||
      canonicalPath.startsWith(`${canonicalRepository}/`)
    )
      throw new BackupExecutionError("unsafe_key_mount");
    return open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  }

  private async prepareRepository(): Promise<void> {
    const stat = await lstat(this.configuration.repository);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0
    )
      throw new BackupExecutionError("unsafe_repository_mount");
    await mkdir(join(this.configuration.repository, "parts"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(join(this.configuration.repository, ".gpg"), {
      recursive: true,
      mode: 0o700,
    });
    for (const directory of ["parts", ".gpg"]) {
      const child = await lstat(join(this.configuration.repository, directory));
      if (
        !child.isDirectory() ||
        child.isSymbolicLink() ||
        (child.mode & 0o077) !== 0
      )
        throw new BackupExecutionError("unsafe_repository_mount");
    }
  }

  private counter(limit: number) {
    const hash = createHash("sha256");
    let count = 0;
    return {
      hash,
      bytes: () => count,
      stream: new Transform({
        transform(chunk: Buffer, _encoding, done) {
          count += chunk.length;
          if (count > limit) {
            done(new BackupExecutionError("part_limit"));
            return;
          }
          hash.update(chunk);
          done(null, chunk);
        },
      }),
    };
  }

  private completed(child: ReturnType<typeof spawn>): Promise<void> {
    const completion = new Promise<void>((resolvePromise, reject) => {
      child.once("error", () =>
        reject(new BackupExecutionError("native_tool_unavailable")),
      );
      child.once("close", (code) =>
        code === 0
          ? resolvePromise()
          : reject(new BackupExecutionError("cryptographic_operation_failed")),
      );
    });
    // Decryption opens its input asynchronously before joining the pipelines.
    // Cancellation may finish the child during that open; observe it immediately.
    void completion.catch(() => undefined);
    return completion;
  }

  private async readCipher(path: string) {
    return (
      await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    ).createReadStream();
  }

  private async syncFile(path: string): Promise<void> {
    const file = await open(path, "r");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }
  private async syncDirectory(path: string): Promise<void> {
    const file = await open(path, "r");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  }
}
