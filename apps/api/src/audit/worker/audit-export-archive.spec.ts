/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/prefer-promise-reject-errors, @typescript-eslint/no-unsafe-argument */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yauzl from "yauzl";

import { buildExportFiles, toCsv } from "./audit-export-serialization";
import { buildStoredZipFile, buildStoredZipStream } from "./audit-export-zip";
import type { AuditExportEvent } from "./audit-export-types";

const execFileAsync = promisify(execFile);
const previousHash = "00".repeat(32);
const organizationId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-10-07T00:00:00.000Z";
const contentHash = (canonical: string) =>
  createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from(previousHash, "hex"),
        Buffer.from(canonical, "utf8"),
      ]),
    )
    .digest("hex");

const eventId = "11111111-1111-4111-8111-111111111111";
const defaultBefore = Object.freeze({
  cell: "\t=bad",
  quote: 'a"b',
  line: "a\nb",
});
const defaultAfter = Object.freeze({ typed: 1, ok: true });
const canonicalFor = (
  input: Readonly<{
    id?: string;
    sequence?: string;
    action?: string;
    entityType?: string;
    entityId?: string | null;
    actorId?: string | null;
    correlationId?: string | null;
    outcome?: string | null;
    createdAt?: string;
    actorType?: string;
    before?: unknown;
    after?: unknown;
    reason?: unknown;
  }> = {},
): string =>
  JSON.stringify({
    id: input.id ?? eventId,
    organization_id: organizationId,
    user_id: null,
    actor_email: null,
    action: input.action ?? "audit.read",
    entity_type: input.entityType ?? "audit_log",
    entity_id: input.entityId ?? "row-1",
    changes: null,
    ip_address: null,
    user_agent: null,
    schema_version: 2,
    event_scope: null,
    event_key: null,
    actor_type: input.actorType ?? "user",
    actor_id: input.actorId ?? "user-1",
    outcome: input.outcome ?? "success",
    correlation_id:
      input.correlationId ?? "22222222-2222-4222-8222-222222222222",
    before_redacted: input.before ?? defaultBefore,
    after_redacted: input.after ?? defaultAfter,
    reason: input.reason ?? null,
    redaction_version: 1,
    chain_version: 1,
    chain_sequence: input.sequence ?? "42",
    created_at: input.createdAt ?? createdAt,
  });
const defaultCanonical = canonicalFor();
const event = (overrides: Partial<AuditExportEvent> = {}): AuditExportEvent =>
  Object.freeze({
    id: eventId,
    sequence: "42",
    previousHash,
    contentHash: contentHash(defaultCanonical),
    canonicalContent: defaultCanonical,
    recomputedCanonicalContent: defaultCanonical,
    canonicalDisclosable: true,
    legacy: false,
    createdAt,
    actorId: "user-1",
    actorType: "user",
    actorLabel: null,
    action: "audit.read",
    resourceType: "audit_log",
    resourceId: "row-1",
    correlationId: "22222222-2222-4222-8222-222222222222",
    outcome: "success",
    before: defaultBefore,
    after: defaultAfter,
    reason: null,
    ...overrides,
  });

describe("audit export archive", () => {
  it("neutralizes spreadsheet formulas and quotes CSV cells", () => {
    const csv = toCsv([
      event({ actorLabel: '=cmd("x")' }),
      event({
        id: "22222222-2222-4222-8222-222222222222",
        actorLabel: "\u00a0=cmd",
        action: "\ufeff@bad",
        resourceType: "\u0085+bad",
      }),
    ]).toString("utf8");
    expect(csv).toContain('"\'=cmd(""x"")"');
    expect(csv).toContain('"\'\u00a0=cmd"');
    expect(csv).toContain('"\'\ufeff@bad"');
    expect(csv).toContain('"\'\u0085+bad"');
    expect(csv).toContain('""cell"":""\\t=bad""');
  });

  it("uses M13-02 previous-hash plus canonical-content proof hashing", () => {
    const files = buildExportFiles({
      events: [event()],
      format: "json",
      manifest: manifestBase(1, 0, 1),
    });
    const proof = JSON.parse(
      files.files
        .find((file) => file.name === "proofs.ndjson")!
        .bytes.toString("utf8"),
    );
    expect(proof.contentHash).toBe(contentHash(defaultCanonical));
    expect(() =>
      buildExportFiles({
        events: [
          event({
            contentHash: createHash("sha256")
              .update(defaultCanonical)
              .digest("hex"),
          }),
        ],
        format: "json",
        manifest: manifestBase(1, 0, 1),
      }),
    ).toThrow("integrity_break");
  });

  it("builds a zip readable by yauzl with manifest and verifier", async () => {
    const { files } = buildExportFiles({
      events: [event()],
      format: "json",
      manifest: manifestBase(1, 0, 1),
    });
    const zip = buildStoredZipStream(
      files.map((file) => ({ name: file.name, bytes: file.bytes })),
    );
    const entries = await readZipEntries(await streamBytes(zip.stream));
    expect([...entries.keys()].sort()).toEqual([
      "events.json",
      "manifest.json",
      "manifest.sha256",
      "proofs.ndjson",
      "verify.mjs",
    ]);
  });

  it("ships an independent verifier that rejects corrupted artifacts", async () => {
    const { files } = buildExportFiles({
      events: [event()],
      format: "json",
      manifest: manifestBase(1, 0, 1),
    });
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-verify-"));
    for (const file of files) await writeFile(join(dir, file.name), file.bytes);
    const verified = await execFileAsync("node", [
      join(dir, "verify.mjs"),
      join(dir, "manifest.json"),
      join(dir, "manifest.sha256"),
      join(dir, "events.json"),
      join(dir, "proofs.ndjson"),
    ]);
    expect(verified.stdout).toContain("audit export verified");
    expect(verified.stdout).toContain('"artifactHashesChecked":true');
    expect(verified.stdout).toContain('"eventProofsChecked":1');
    expect(verified.stdout).toContain('"proofsUnavailable":0');
    expect(verified.stdout).toContain('"authenticityProven":false');
    await writeFile(join(dir, "events.json"), Buffer.from("[]\n"));
    await expect(
      execFileAsync("node", [
        join(dir, "verify.mjs"),
        join(dir, "manifest.json"),
        join(dir, "manifest.sha256"),
        join(dir, "events.json"),
        join(dir, "proofs.ndjson"),
      ]),
    ).rejects.toThrow();
  });

  it("rejects proofs whose canonical event identity is rebound to another exported row", async () => {
    const firstCanonical = canonicalFor();
    const secondId = "22222222-2222-4222-8222-222222222222";
    const secondCanonical = canonicalFor({ id: secondId, sequence: "41" });
    const built = buildExportFiles({
      events: [
        event({
          canonicalContent: firstCanonical,
          recomputedCanonicalContent: firstCanonical,
          contentHash: contentHash(firstCanonical),
        }),
        event({
          id: secondId,
          sequence: "41",
          canonicalContent: secondCanonical,
          recomputedCanonicalContent: secondCanonical,
          contentHash: contentHash(secondCanonical),
        }),
      ],
      format: "json",
      manifest: {
        ...manifestBase(2, 0, 2),
        sequenceRange: { from: "41", to: "42" },
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-verify-binding-"));
    const files = new Map<string, Buffer>(
      built.files.map((file) => [file.name, Buffer.from(file.bytes)]),
    );
    const proofs = files
      .get("proofs.ndjson")!
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    proofs[0] = {
      ...proofs[0],
      canonicalContent: secondCanonical,
      contentHash: contentHash(secondCanonical),
    };
    files.set(
      "proofs.ndjson",
      Buffer.from(
        `${proofs.map((proof) => JSON.stringify(proof)).join("\n")}\n`,
        "utf8",
      ),
    );
    const manifest = JSON.parse(
      files.get("manifest.json")!.toString("utf8"),
    ) as { files: Array<{ name: string; sha256: string; bytes: number }> };
    manifest.files = manifest.files.map((file) => {
      const bytes = files.get(file.name)!;
      return {
        ...file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      };
    });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
    files.set("manifest.json", manifestBytes);
    files.set(
      "manifest.sha256",
      Buffer.from(
        `${createHash("sha256").update(manifestBytes).digest("hex")}\n`,
        "utf8",
      ),
    );
    for (const [name, bytes] of files) await writeFile(join(dir, name), bytes);
    await expect(
      execFileAsync("node", [
        join(dir, "verify.mjs"),
        join(dir, "manifest.json"),
        join(dir, "manifest.sha256"),
        join(dir, "events.json"),
        join(dir, "proofs.ndjson"),
      ]),
    ).rejects.toThrow(/canonical event mismatch/);
  });

  it("rejects proofs whose sequence no longer matches the exported row", async () => {
    const firstCanonical = canonicalFor();
    const secondId = "22222222-2222-4222-8222-222222222222";
    const secondCanonical = canonicalFor({ id: secondId, sequence: "41" });
    const built = buildExportFiles({
      events: [
        event({
          canonicalContent: firstCanonical,
          recomputedCanonicalContent: firstCanonical,
          contentHash: contentHash(firstCanonical),
        }),
        event({
          id: secondId,
          sequence: "41",
          canonicalContent: secondCanonical,
          recomputedCanonicalContent: secondCanonical,
          contentHash: contentHash(secondCanonical),
        }),
      ],
      format: "json",
      manifest: {
        ...manifestBase(2, 0, 2),
        sequenceRange: { from: "41", to: "42" },
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-verify-sequence-"));
    const files = new Map<string, Buffer>(
      built.files.map((file) => [file.name, Buffer.from(file.bytes)]),
    );
    const events = JSON.parse(
      files.get("events.json")!.toString("utf8"),
    ) as Array<Record<string, unknown>>;
    events[0] = { ...events[0], sequence: "41" };
    events[1] = { ...events[1], sequence: "42" };
    files.set(
      "events.json",
      Buffer.from(`${JSON.stringify(events)}\n`, "utf8"),
    );
    const manifest = JSON.parse(
      files.get("manifest.json")!.toString("utf8"),
    ) as { files: Array<{ name: string; sha256: string; bytes: number }> };
    manifest.files = manifest.files.map((file) => {
      const bytes = files.get(file.name)!;
      return {
        ...file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      };
    });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
    files.set("manifest.json", manifestBytes);
    files.set(
      "manifest.sha256",
      Buffer.from(
        `${createHash("sha256").update(manifestBytes).digest("hex")}\n`,
        "utf8",
      ),
    );
    for (const [name, bytes] of files) await writeFile(join(dir, name), bytes);
    await expect(
      execFileAsync("node", [
        join(dir, "verify.mjs"),
        join(dir, "manifest.json"),
        join(dir, "manifest.sha256"),
        join(dir, "events.json"),
        join(dir, "proofs.ndjson"),
      ]),
    ).rejects.toThrow(/proof sequence mismatch/);
  });

  it("rejects exported semantic fields that no longer match disclosed canonical content", async () => {
    const canonical = canonicalFor({
      actorType: "system",
      actorId: null,
      before: { state: "before" },
      after: { state: "after" },
      reason: "reviewed",
    });
    const built = buildExportFiles({
      events: [
        event({
          actorType: "system",
          actorId: null,
          before: { state: "before" },
          after: { state: "after" },
          reason: "reviewed",
          canonicalContent: canonical,
          recomputedCanonicalContent: canonical,
          contentHash: contentHash(canonical),
        }),
      ],
      format: "json",
      manifest: manifestBase(1, 0, 1),
    });
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-verify-fields-"));
    const files = new Map<string, Buffer>(
      built.files.map((file) => [file.name, Buffer.from(file.bytes)]),
    );
    const events = JSON.parse(
      files.get("events.json")!.toString("utf8"),
    ) as Array<Record<string, unknown>>;
    events[0] = {
      ...events[0],
      actor_type: "user",
      before: { state: "tampered" },
      after: { state: "after" },
      reason: "changed",
    };
    files.set(
      "events.json",
      Buffer.from(`${JSON.stringify(events)}\n`, "utf8"),
    );
    const manifest = JSON.parse(
      files.get("manifest.json")!.toString("utf8"),
    ) as { files: Array<{ name: string; sha256: string; bytes: number }> };
    manifest.files = manifest.files.map((file) => {
      const bytes = files.get(file.name)!;
      return {
        ...file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      };
    });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
    files.set("manifest.json", manifestBytes);
    files.set(
      "manifest.sha256",
      Buffer.from(
        `${createHash("sha256").update(manifestBytes).digest("hex")}\n`,
        "utf8",
      ),
    );
    for (const [name, bytes] of files) await writeFile(join(dir, name), bytes);
    await expect(
      execFileAsync("node", [
        join(dir, "verify.mjs"),
        join(dir, "manifest.json"),
        join(dir, "manifest.sha256"),
        join(dir, "events.json"),
        join(dir, "proofs.ndjson"),
      ]),
    ).rejects.toThrow(/canonical actor type mismatch/);
  });

  it("builds production zip files from disk and rejects unsafe disk entry names", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-zip-valid-"));
    const large = join(dir, "large.txt");
    const small = join(dir, "small.txt");
    await writeFile(large, Buffer.alloc(1024 * 1024, "a"));
    await writeFile(small, Buffer.from("ok"));
    const output = join(dir, "out.zip");
    const built = await buildStoredZipFile({
      files: [
        { name: "small.txt", path: small },
        { name: "large.txt", path: large },
      ],
      outputPath: output,
      maximumBytes: 2 * 1024 * 1024,
    });
    expect(built.byteSize).toBeGreaterThan(1024 * 1024);
    const entries = await readZipEntries(await readFileBuffer(output));
    expect([...entries.keys()].sort()).toEqual(["large.txt", "small.txt"]);

    await expect(
      buildStoredZipFile({
        files: [{ name: "../large.txt", path: large }],
        outputPath: join(dir, "bad.zip"),
        maximumBytes: 2 * 1024 * 1024,
      }),
    ).rejects.toThrow("unsafe archive path");
  });

  it("keeps JSON typed strings and legitimate leading apostrophes distinct", async () => {
    const canonical = canonicalFor({
      before: "123",
      after: "null",
      reason: "'=kept",
    });
    const { files } = buildExportFiles({
      events: [
        event({
          before: "123",
          after: "null",
          reason: "'=kept",
          canonicalContent: canonical,
          recomputedCanonicalContent: canonical,
          contentHash: contentHash(canonical),
        }),
      ],
      format: "json",
      manifest: manifestBase(1, 0, 1),
    });
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-verify-strings-"));
    for (const file of files) await writeFile(join(dir, file.name), file.bytes);
    await expect(
      execFileAsync("node", [
        join(dir, "verify.mjs"),
        join(dir, "manifest.json"),
        join(dir, "manifest.sha256"),
        join(dir, "events.json"),
        join(dir, "proofs.ndjson"),
      ]),
    ).resolves.toBeDefined();
  });

  it("verifies CSV-neutralized formula strings without accepting apostrophe stripping ambiguity", async () => {
    const canonical = canonicalFor({ reason: "=reviewed" });
    const { files } = buildExportFiles({
      events: [
        event({
          reason: "=reviewed",
          canonicalContent: canonical,
          recomputedCanonicalContent: canonical,
          contentHash: contentHash(canonical),
        }),
      ],
      format: "csv",
      manifest: { ...manifestBase(1, 0, 1), format: "csv" },
    });
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-verify-csv-"));
    for (const file of files) await writeFile(join(dir, file.name), file.bytes);
    await expect(
      execFileAsync("node", [
        join(dir, "verify.mjs"),
        join(dir, "manifest.json"),
        join(dir, "manifest.sha256"),
        join(dir, "events.csv"),
        join(dir, "proofs.ndjson"),
      ]),
    ).resolves.toBeDefined();
  });

  it("verifies CSV-neutralized scalar identity fields", async () => {
    const canonical = canonicalFor({
      action: "\u00a0=audit.read",
      entityType: "\u0085+audit_log",
      entityId: "@resource",
      actorId: "@actor",
    });
    const { files } = buildExportFiles({
      events: [
        event({
          action: "\u00a0=audit.read",
          resourceType: "\u0085+audit_log",
          resourceId: "@resource",
          actorId: "@actor",
          canonicalContent: canonical,
          recomputedCanonicalContent: canonical,
          contentHash: contentHash(canonical),
        }),
      ],
      format: "csv",
      manifest: { ...manifestBase(1, 0, 1), format: "csv" },
    });
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-verify-csv-scalars-"));
    for (const file of files) await writeFile(join(dir, file.name), file.bytes);
    await expect(
      execFileAsync("node", [
        join(dir, "verify.mjs"),
        join(dir, "manifest.json"),
        join(dir, "manifest.sha256"),
        join(dir, "events.csv"),
        join(dir, "proofs.ndjson"),
      ]),
    ).resolves.toBeDefined();
  });

  it("rejects proofs attached to legacy-labeled or actor-label-spoofed rows", async () => {
    const canonical = canonicalFor();
    const built = buildExportFiles({
      events: [
        event({
          actorLabel: null,
          canonicalContent: canonical,
          recomputedCanonicalContent: canonical,
          contentHash: contentHash(canonical),
        }),
      ],
      format: "json",
      manifest: manifestBase(1, 0, 1),
    });
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-verify-legacy-"));
    const files = new Map<string, Buffer>(
      built.files.map((file) => [file.name, Buffer.from(file.bytes)]),
    );
    const events = JSON.parse(
      files.get("events.json")!.toString("utf8"),
    ) as Array<Record<string, unknown>>;
    events[0] = { ...events[0], legacy: true, actor_label: "Actor" };
    files.set(
      "events.json",
      Buffer.from(`${JSON.stringify(events)}\n`, "utf8"),
    );
    const manifest = JSON.parse(
      files.get("manifest.json")!.toString("utf8"),
    ) as {
      legacyCount: number;
      files: Array<{ name: string; sha256: string; bytes: number }>;
    };
    manifest.legacyCount = 1;
    manifest.files = manifest.files.map((file) => {
      const bytes = files.get(file.name)!;
      return {
        ...file,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.byteLength,
      };
    });
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
    files.set("manifest.json", manifestBytes);
    files.set(
      "manifest.sha256",
      Buffer.from(
        `${createHash("sha256").update(manifestBytes).digest("hex")}\n`,
        "utf8",
      ),
    );
    for (const [name, bytes] of files) await writeFile(join(dir, name), bytes);
    await expect(
      execFileAsync("node", [
        join(dir, "verify.mjs"),
        join(dir, "manifest.json"),
        join(dir, "manifest.sha256"),
        join(dir, "events.json"),
        join(dir, "proofs.ndjson"),
      ]),
    ).rejects.toThrow(/proof references legacy event/);
  });

  it("rejects unsafe zip paths and byte caps", async () => {
    expect(() =>
      buildStoredZipStream([{ name: "../bad", bytes: Buffer.from("x") }]),
    ).toThrow("unsafe archive path");
    expect(() =>
      buildStoredZipStream([
        { name: "same", bytes: Buffer.from("x") },
        { name: "same", bytes: Buffer.from("y") },
      ]),
    ).toThrow("unsafe archive path");
    const dir = await mkdtemp(join(tmpdir(), "cra-audit-zip-"));
    const part = join(dir, "part.txt");
    await writeFile(part, Buffer.from("too-large"));
    await expect(
      buildStoredZipFile({
        files: [{ name: "part.txt", path: part }],
        outputPath: join(dir, "out.zip"),
        maximumBytes: 2,
      }),
    ).rejects.toThrow("export_limit");
  });
});

function manifestBase(
  rowCount: number,
  legacyCount: number,
  proofCount: number,
) {
  return {
    schema: "cra.audit-export.v1" as const,
    hashAlgorithm: "sha256" as const,
    organizationId: "33333333-3333-4333-8333-333333333333",
    scopeDigest: "11".repeat(32),
    filters: {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-08T00:00:00.000Z",
    },
    format: "json" as const,
    generatedAt: "2026-10-07T00:00:00.000Z",
    timezone: "UTC" as const,
    ordering: "sequence_desc_then_legacy_created_at_id_desc" as const,
    sequenceRange: { from: "42", to: "42" },
    rowCount,
    legacyCount,
    proofCount,
    completenessProven: false as const,
    authenticityProven: false as const,
  };
}

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readFileBuffer(path: string): Promise<Buffer> {
  return readFile(path);
}

function readZipEntries(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError);
      const entries = new Map<string, Buffer>();
      zip.readEntry();
      zip.on("entry", (entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError);
          streamBytes(stream).then((entryBytes) => {
            entries.set(entry.fileName, entryBytes);
            zip.readEntry();
          }, reject);
        });
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
    });
  });
}
