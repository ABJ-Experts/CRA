import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditExportManifest } from "@repo/contracts/audit/types";
import type { AuditExportEvent, JsonValue } from "./audit-export-types";

export type ExportFile = Readonly<{
  name:
    | "events.csv"
    | "events.json"
    | "proofs.ndjson"
    | "verify.mjs"
    | "manifest.json"
    | "manifest.sha256";
  bytes: Buffer;
}>;

const csvColumns = Object.freeze([
  "sequence",
  "event_id",
  "created_at",
  "legacy",
  "actor_type",
  "actor_id",
  "actor_label",
  "action",
  "resource_type",
  "resource_id",
  "correlation_id",
  "outcome",
  "before",
  "after",
  "reason",
]);

// Spreadsheet formula injection can start after leading Unicode whitespace, BOM, or control characters.
const formula = /^[\s\p{Cc}\uFEFF]*[=+\-@]/u;
const hash = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");
const contentHash = (previousHash: string, canonicalContent: string): string =>
  hash(
    Buffer.concat([
      Buffer.from(previousHash, "hex"),
      Buffer.from(canonicalContent, "utf8"),
    ]),
  );

export const stableJson = (value: unknown): string => JSON.stringify(value);

export function toCsv(events: readonly AuditExportEvent[]): Buffer {
  const rows = [csvColumns.join(",")];
  for (const event of events)
    rows.push(
      csvColumns
        .map((key) => encodeAuditCsvCell(valueForCsv(event, key)))
        .join(","),
    );
  return Buffer.from(`${rows.join("\n")}\n`, "utf8");
}

export function toJson(events: readonly AuditExportEvent[]): Buffer {
  return Buffer.from(`${stableJson(events.map(toPublicEvent))}\n`, "utf8");
}

export function buildProofs(events: readonly AuditExportEvent[]): Buffer {
  const lines = events.flatMap((event) => {
    if (
      event.legacy ||
      !event.sequence ||
      !event.previousHash ||
      !event.contentHash
    )
      return [];
    if (!event.canonicalDisclosable || event.canonicalContent === null)
      return [];
    const measuredContentHash = contentHash(
      event.previousHash,
      event.canonicalContent,
    );
    if (measuredContentHash !== event.contentHash)
      throw new Error("integrity_break");
    return [
      stableJson({
        eventId: event.id,
        sequence: event.sequence,
        previousHash: event.previousHash,
        contentHash: event.contentHash,
        canonicalContent: event.canonicalContent,
      }),
    ];
  });
  return Buffer.from(lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
}

export function verifySourceHashes(events: readonly AuditExportEvent[]): void {
  for (const event of events) {
    if (event.legacy || !event.contentHash || event.canonicalContent === null)
      continue;
    if (
      !event.previousHash ||
      contentHash(event.previousHash, event.canonicalContent) !==
        event.contentHash
    ) {
      throw new Error("integrity_break");
    }
  }
}

export function buildExportFiles(
  input: Readonly<{
    events: readonly AuditExportEvent[];
    manifest: Omit<AuditExportManifest, "files">;
    format: "csv" | "json";
  }>,
): Readonly<{ files: readonly ExportFile[]; manifest: AuditExportManifest }> {
  verifySourceHashes(input.events);
  const eventFile =
    input.format === "csv" ? toCsv(input.events) : toJson(input.events);
  const proofs = buildProofs(input.events);
  const verifier = readVerifierBytes();
  const eventName: "events.csv" | "events.json" = `events.${input.format}`;
  const filesForManifest: readonly Readonly<{
    name: "events.csv" | "events.json" | "proofs.ndjson" | "verify.mjs";
    bytes: Buffer;
  }>[] = [
    { name: eventName, bytes: eventFile },
    { name: "proofs.ndjson", bytes: proofs },
    { name: "verify.mjs", bytes: verifier },
  ];
  const manifest: AuditExportManifest = Object.freeze({
    ...input.manifest,
    files: filesForManifest.map((file) => ({
      name: file.name,
      sha256: hash(file.bytes),
      bytes: file.bytes.byteLength,
    })),
  });
  const manifestBytes = Buffer.from(`${stableJson(manifest)}\n`, "utf8");
  const manifestHash = Buffer.from(`${hash(manifestBytes)}\n`, "utf8");
  const files: readonly ExportFile[] = Object.freeze([
    { name: eventName, bytes: eventFile },
    { name: "proofs.ndjson", bytes: proofs },
    { name: "verify.mjs", bytes: verifier },
    { name: "manifest.json", bytes: manifestBytes },
    { name: "manifest.sha256", bytes: manifestHash },
  ]);
  return Object.freeze({ manifest, files });
}

function valueForCsv(event: AuditExportEvent, key: string): string {
  const publicEvent = toPublicEvent(event) as Record<string, unknown>;
  if (key === "event_id") return event.id;
  if (key === "resource_type") return event.resourceType;
  if (key === "resource_id") return event.resourceId ?? "";
  if (key === "created_at") return event.createdAt;
  if (key === "actor_type") return event.actorType;
  if (key === "actor_id") return event.actorId ?? "";
  if (key === "actor_label") return event.actorLabel ?? "";
  const value = publicEvent[key];
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : stableJson(value);
}

export function encodeAuditCsvCell(value: string): string {
  const safe = formula.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toPublicEvent(event: AuditExportEvent): Record<string, JsonValue> {
  return {
    sequence: event.sequence,
    event_id: event.id,
    created_at: event.createdAt,
    legacy: event.legacy,
    actor_type: event.actorType,
    actor_id: event.actorId,
    actor_label: event.actorLabel,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    correlation_id: event.correlationId,
    outcome: event.outcome,
    before: event.before,
    after: event.after,
    reason: event.reason,
  };
}

function readVerifierBytes(): Buffer {
  try {
    return readFileSync(join(__dirname, "verify.mjs"));
  } catch {
    return readFileSync(
      join(process.cwd(), "apps/api/src/audit/worker/verify.mjs"),
    );
  }
}
