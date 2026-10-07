#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const usage =
  "usage: node verify.mjs manifest.json manifest.sha256 events.csv|events.json proofs.ndjson";
const args = process.argv.slice(2);
if (args.length < 4) throw new Error(usage);
const [manifestPath, detachedPath, eventsPath, proofsPath] = args;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[a-f0-9]{64}$/;
const sequence = /^\d+$/;
// Spreadsheet neutralization can be prefixed after leading Unicode whitespace, BOM, or control characters.
const formula = /^[\s\p{Cc}\uFEFF]*[=+\-@]/u;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const contentHash = (previousHash, canonicalContent) =>
  sha256(
    Buffer.concat([
      Buffer.from(previousHash, "hex"),
      Buffer.from(canonicalContent, "utf8"),
    ]),
  );
const read = (path) => readFileSync(path);
const manifestBytes = read(manifestPath);
const detached = read(detachedPath).toString("utf8").trim();
if (!digest.test(detached) || detached !== sha256(manifestBytes)) {
  throw new Error("manifest hash mismatch");
}
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (
  manifest.schema !== "cra.audit-export.v1" ||
  manifest.hashAlgorithm !== "sha256" ||
  manifest.completenessProven !== false ||
  manifest.authenticityProven !== false
) {
  throw new Error("unsupported manifest");
}
const files = new Map(manifest.files.map((file) => [file.name, file]));
for (const path of [eventsPath, proofsPath, process.argv[1]]) {
  const name = basename(path);
  const expected = files.get(name);
  if (!expected) throw new Error(`manifest missing ${name}`);
  const bytes = read(path);
  if (
    bytes.byteLength !== expected.bytes ||
    sha256(bytes) !== expected.sha256
  ) {
    throw new Error(`artifact hash mismatch: ${name}`);
  }
}
const eventsName = basename(eventsPath);
const eventFormat = eventsName === "events.csv" ? "csv" : "json";
const events = parseEvents(eventsName, read(eventsPath).toString("utf8"));
if (events.length !== manifest.rowCount)
  throw new Error("event row count mismatch");
const eventIds = new Set();
const eventsById = new Map();
let legacyCount = 0;
let minSequence = null;
let maxSequence = null;
for (const event of events) {
  if (!uuid.test(event.event_id) || eventIds.has(event.event_id))
    throw new Error("invalid event id");
  eventIds.add(event.event_id);
  eventsById.set(event.event_id, event);
  const legacy = event.legacy === true || event.legacy === "true";
  if (legacy) legacyCount += 1;
  if (event.sequence !== null && event.sequence !== "") {
    if (!sequence.test(String(event.sequence)))
      throw new Error("invalid event sequence");
    minSequence =
      minSequence === null || BigInt(event.sequence) < BigInt(minSequence)
        ? String(event.sequence)
        : minSequence;
    maxSequence =
      maxSequence === null || BigInt(event.sequence) > BigInt(maxSequence)
        ? String(event.sequence)
        : maxSequence;
  }
}
if (legacyCount !== manifest.legacyCount)
  throw new Error("legacy count mismatch");
if (
  (manifest.sequenceRange.from ?? null) !== minSequence ||
  (manifest.sequenceRange.to ?? null) !== maxSequence
) {
  throw new Error("sequence range mismatch");
}
const proofLines = read(proofsPath)
  .toString("utf8")
  .trim()
  .split(/\n/)
  .filter(Boolean);
if (proofLines.length !== manifest.proofCount)
  throw new Error("proof count mismatch");
const seenProofs = new Set();
let previousSequence = null;
for (const line of proofLines) {
  const proof = JSON.parse(line);
  const event = eventsById.get(proof.eventId);
  if (!uuid.test(proof.eventId) || !event)
    throw new Error(`proof without exported event: ${proof.eventId}`);
  if (seenProofs.has(proof.eventId))
    throw new Error(`duplicate proof: ${proof.eventId}`);
  seenProofs.add(proof.eventId);
  if (
    !sequence.test(proof.sequence) ||
    !digest.test(proof.previousHash) ||
    !digest.test(proof.contentHash) ||
    typeof proof.canonicalContent !== "string"
  ) {
    throw new Error(`malformed proof: ${proof.eventId}`);
  }
  if (
    contentHash(proof.previousHash, proof.canonicalContent) !==
    proof.contentHash
  ) {
    throw new Error(`proof content hash mismatch: ${proof.eventId}`);
  }
  if (event.legacy === true || event.legacy === "true")
    throw new Error(`proof references legacy event: ${proof.eventId}`);
  if (String(event.sequence) !== proof.sequence)
    throw new Error(`proof sequence mismatch: ${proof.eventId}`);
  assertCanonicalBinding(proof, event, manifest, eventFormat);
  if (previousSequence !== null && BigInt(proof.sequence) >= previousSequence) {
    throw new Error("proof sequence order mismatch");
  }
  previousSequence = BigInt(proof.sequence);
}
console.log(
  `audit export verified ${JSON.stringify({
    artifactHashesChecked: true,
    eventProofsChecked: proofLines.length,
    proofsUnavailable:
      manifest.rowCount - manifest.legacyCount - manifest.proofCount,
    legacyUnchained: manifest.legacyCount,
    completenessProven: false,
    authenticityProven: false,
  })}`,
);

function assertCanonicalBinding(proof, event, manifest, eventFormat) {
  let canonical;
  try {
    canonical = JSON.parse(proof.canonicalContent);
  } catch {
    throw new Error(`malformed canonical proof: ${proof.eventId}`);
  }
  if (!canonical || typeof canonical !== "object" || Array.isArray(canonical))
    throw new Error(`malformed canonical proof: ${proof.eventId}`);

  requireEqual(
    canonical,
    "id",
    proof.eventId,
    proof.eventId,
    "event",
    eventFormat,
  );
  requireEqual(
    canonical,
    "organization_id",
    manifest.organizationId,
    proof.eventId,
    "organization",
    eventFormat,
  );
  requireEqual(
    canonical,
    "chain_sequence",
    proof.sequence,
    proof.eventId,
    "sequence",
    eventFormat,
  );
  requireEqual(
    canonical,
    "action",
    event.action,
    proof.eventId,
    "action",
    eventFormat,
  );
  requireEqual(
    canonical,
    "actor_type",
    event.actor_type,
    proof.eventId,
    "actor type",
    eventFormat,
  );
  requireEqual(
    canonical,
    "entity_type",
    event.resource_type,
    proof.eventId,
    "resource type",
    eventFormat,
  );
  compareNullable(
    canonical,
    "entity_id",
    event.resource_id,
    proof.eventId,
    "resource id",
    eventFormat,
  );
  compareNullable(
    canonical,
    "correlation_id",
    event.correlation_id,
    proof.eventId,
    "correlation id",
    eventFormat,
  );
  compareNullable(
    canonical,
    "outcome",
    event.outcome,
    proof.eventId,
    "outcome",
    eventFormat,
  );
  requireEqual(
    canonical,
    "created_at",
    event.created_at,
    proof.eventId,
    "created at",
    eventFormat,
  );

  const canonicalActorId =
    nullableString(canonical.actor_id) ?? nullableString(canonical.user_id);
  const exportedActorId = nullableString(event.actor_id);
  if (!scalarMatches(canonicalActorId, exportedActorId, eventFormat))
    throw new Error(`canonical actor id mismatch: ${proof.eventId}`);
  if (nullableString(event.actor_label) !== null)
    throw new Error(`canonical actor label mismatch: ${proof.eventId}`);
  compareJsonValue(
    canonical.before_redacted,
    event.before,
    proof.eventId,
    "before",
    eventFormat,
  );
  compareJsonValue(
    canonical.after_redacted,
    event.after,
    proof.eventId,
    "after",
    eventFormat,
  );
  compareJsonValue(
    canonical.reason,
    event.reason,
    proof.eventId,
    "reason",
    eventFormat,
  );
}
function requireEqual(source, key, expected, eventId, label, eventFormat) {
  const value = nullableString(source[key]);
  if (value === null || !scalarMatches(value, expected, eventFormat))
    throw new Error(`canonical ${label} mismatch: ${eventId}`);
}
function compareNullable(source, key, expected, eventId, label, eventFormat) {
  const value = nullableString(source[key]);
  const normalizedExpected = nullableString(expected);
  if (!scalarMatches(value, normalizedExpected, eventFormat))
    throw new Error(`canonical ${label} mismatch: ${eventId}`);
}
function scalarMatches(canonicalValue, exportedValue, eventFormat) {
  if (canonicalValue === exportedValue) return true;
  if (eventFormat !== "csv" || typeof canonicalValue !== "string") return false;
  return formula.test(canonicalValue) && exportedValue === `'${canonicalValue}`;
}
function compareJsonValue(
  canonicalValue,
  exportedValue,
  eventId,
  label,
  eventFormat,
) {
  const normalizedCanonical = canonicalValue ?? null;
  const normalizedExported =
    eventFormat === "csv"
      ? parseCsvExportedValue(exportedValue, normalizedCanonical)
      : (exportedValue ?? null);
  if (!deepEqual(normalizedCanonical, normalizedExported))
    throw new Error(`canonical ${label} mismatch: ${eventId}`);
}
function parseCsvExportedValue(value, canonicalValue) {
  if (typeof value !== "string") return value ?? null;
  if (typeof canonicalValue === "string") {
    if (value === canonicalValue) return value;
    return value.startsWith("'") && formula.test(value.slice(1))
      ? value.slice(1)
      : value;
  }
  if (value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return left === right;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (typeof left === "object" || typeof right === "object") {
    if (typeof left !== "object" || typeof right !== "object") return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && deepEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

function nullableString(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function parseEvents(name, text) {
  if (name === "events.json") return JSON.parse(text);
  if (name !== "events.csv") throw new Error("unsupported events artifact");
  const rows = parseCsv(text);
  const [header, ...records] = rows;
  if (!header) throw new Error("empty csv");
  return records
    .filter((row) => row.length > 1 || row[0] !== "")
    .map((row) =>
      Object.fromEntries(header.map((key, index) => [key, row[index] ?? ""])),
    );
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
