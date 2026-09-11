import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from "node:crypto";

export type OfflineBundlePayload = Readonly<{
  path: string;
  feedKey: string;
  schemaVersion: string;
  sourceSnapshotAt: string;
  byteLength: number;
  sha256: string;
}>;

export type OfflineBundleManifest = Readonly<{
  format: "cra.vulnerability.offline-bundle";
  schemaVersion: "1.0";
  bundleVersion: string;
  createdAt: string;
  signingKeyId: string;
  compatibility: Readonly<{
    minimumApplicationVersion: string;
    maximumApplicationVersionExclusive: string;
  }>;
  payloads: readonly OfflineBundlePayload[];
}>;

export type OfflineBundleTrustedKey = Readonly<{
  keyId: string;
  /** PEM SubjectPublicKeyInfo or a base64-encoded Ed25519 SubjectPublicKeyInfo. */
  publicKey: string;
  notBefore: string | null;
  notAfter: string | null;
  revokedAt: string | null;
}>;

export type OfflineBundleTrustedKeyring = Readonly<{
  keys: readonly OfflineBundleTrustedKey[];
}>;

export type OfflineBundleVerification = Readonly<{
  manifestSha256: string;
  signingKeyId: string;
  compatibility: "compatible";
  payloadCount: number;
  payloads: readonly OfflineBundlePayload[];
}>;

export type OfflineBundlePayloadContent = Readonly<{
  byteLength: number;
  sha256: string;
}>;

export class BundleVerificationError extends Error {
  constructor(
    readonly code:
      | "bundle_manifest_invalid"
      | "bundle_signature_invalid"
      | "bundle_key_untrusted"
      | "bundle_key_not_active"
      | "bundle_incompatible"
      | "payload_inventory_invalid"
      | "payload_size_invalid"
      | "payload_hash_invalid",
  ) {
    super(code);
    this.name = "BundleVerificationError";
  }
}

/**
 * Stable JSON serialisation is part of the signed wire protocol. Objects are
 * recursively sorted; arrays deliberately retain manifest-specified order.
 */
export function canonicalBundleManifest(
  manifest: OfflineBundleManifest,
): string {
  return JSON.stringify(sortJson(manifest));
}

export function offlineBundleSignaturePreimage(
  manifest: OfflineBundleManifest,
): Buffer {
  return Buffer.from(
    `CRA-VULNERABILITY-BUNDLE-V1\n${canonicalBundleManifest(manifest)}`,
    "utf8",
  );
}

/**
 * Verifies the complete untrusted multipart set before it reaches a staging
 * RPC. This function never emits raw signing material or payload content.
 */
export function verifyOfflineBundle(
  input: Readonly<{
    manifest: OfflineBundleManifest;
    signature: Buffer;
    payloads: ReadonlyMap<string, OfflineBundlePayloadContent>;
    keyring: OfflineBundleTrustedKeyring;
    applicationVersion: string;
    now: Date;
  }>,
): OfflineBundleVerification {
  validateManifest(input.manifest);
  const key = trustedKey(input.manifest.signingKeyId, input.keyring, input.now);
  if (!isCompatible(input.applicationVersion, input.manifest.compatibility)) {
    throw new BundleVerificationError("bundle_incompatible");
  }
  // Reject an incomplete or ambiguous multipart inventory before accepting a
  // detached signature over it. This bounds work and produces a useful,
  // non-sensitive operator outcome for a malformed upload.
  verifyPayloadInventory(input.manifest.payloads, input.payloads);
  if (
    !verify(
      null,
      offlineBundleSignaturePreimage(input.manifest),
      publicKey(key.publicKey),
      input.signature,
    )
  ) {
    throw new BundleVerificationError("bundle_signature_invalid");
  }
  return {
    manifestSha256: sha256(
      Buffer.from(canonicalBundleManifest(input.manifest)),
    ),
    signingKeyId: key.keyId,
    compatibility: "compatible",
    payloadCount: input.manifest.payloads.length,
    payloads: input.manifest.payloads,
  };
}

function validateManifest(manifest: OfflineBundleManifest): void {
  if (
    manifest.format !== "cra.vulnerability.offline-bundle" ||
    manifest.schemaVersion !== "1.0" ||
    !manifest.bundleVersion ||
    !manifest.signingKeyId ||
    !validUtc(manifest.createdAt) ||
    !validVersion(manifest.bundleVersion) ||
    !validVersion(manifest.compatibility.minimumApplicationVersion) ||
    !validVersion(manifest.compatibility.maximumApplicationVersionExclusive) ||
    compareVersions(
      manifest.compatibility.minimumApplicationVersion,
      manifest.compatibility.maximumApplicationVersionExclusive,
    ) >= 0 ||
    manifest.payloads.length === 0
  ) {
    throw new BundleVerificationError("bundle_manifest_invalid");
  }
}

function trustedKey(
  keyId: string,
  keyring: OfflineBundleTrustedKeyring,
  now: Date,
): OfflineBundleTrustedKey {
  const key = keyring.keys.filter((candidate) => candidate.keyId === keyId);
  if (key.length !== 1)
    throw new BundleVerificationError("bundle_key_untrusted");
  const selected = key[0]!;
  if (
    !selected.publicKey ||
    !validOptionalUtc(selected.notBefore) ||
    !validOptionalUtc(selected.notAfter) ||
    !validOptionalUtc(selected.revokedAt)
  ) {
    throw new BundleVerificationError("bundle_key_untrusted");
  }
  const instant = now.getTime();
  if (
    (selected.notBefore && instant < Date.parse(selected.notBefore)) ||
    (selected.notAfter && instant >= Date.parse(selected.notAfter)) ||
    (selected.revokedAt && instant >= Date.parse(selected.revokedAt))
  ) {
    throw new BundleVerificationError("bundle_key_not_active");
  }
  return selected;
}

function verifyPayloadInventory(
  entries: readonly OfflineBundlePayload[],
  payloads: ReadonlyMap<string, OfflineBundlePayloadContent>,
): void {
  const names = entries.map((entry) => entry.path);
  if (
    new Set(names).size !== names.length ||
    names.some((name, index) => index > 0 && names[index - 1]! >= name) ||
    payloads.size !== entries.length ||
    entries.some(
      (entry) =>
        !validPayloadPath(entry.path) ||
        !entry.feedKey ||
        !entry.schemaVersion ||
        !validUtc(entry.sourceSnapshotAt) ||
        !Number.isSafeInteger(entry.byteLength) ||
        entry.byteLength < 0 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !payloads.has(entry.path),
    )
  ) {
    throw new BundleVerificationError("payload_inventory_invalid");
  }
  for (const entry of entries) {
    const payload = payloads.get(entry.path);
    if (!payload || payload.byteLength !== entry.byteLength) {
      throw new BundleVerificationError("payload_size_invalid");
    }
    if (payload.sha256 !== entry.sha256) {
      throw new BundleVerificationError("payload_hash_invalid");
    }
  }
}

function publicKey(value: string): KeyObject {
  try {
    const key = value.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(value)
      : createPublicKey({
          key: Buffer.from(value, "base64"),
          format: "der",
          type: "spki",
        });
    if (key.asymmetricKeyType !== "ed25519") {
      throw new BundleVerificationError("bundle_key_untrusted");
    }
    return key;
  } catch {
    throw new BundleVerificationError("bundle_key_untrusted");
  }
}

function isCompatible(
  applicationVersion: string,
  range: OfflineBundleManifest["compatibility"],
): boolean {
  return (
    validVersion(applicationVersion) &&
    compareVersions(applicationVersion, range.minimumApplicationVersion) >= 0 &&
    compareVersions(
      applicationVersion,
      range.maximumApplicationVersionExclusive,
    ) < 0
  );
}

function validVersion(value: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  );
}

function compareVersions(left: string, right: string): number {
  const [leftPublic] = left.split("+", 1);
  const [rightPublic] = right.split("+", 1);
  const [leftCore, leftPrerelease = ""] = leftPublic!.split("-", 2);
  const [rightCore, rightPrerelease = ""] = rightPublic!.split("-", 2);
  const leftParts = leftCore!.split(".").map(Number);
  const rightParts = rightCore!.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index]! - rightParts[index]!;
    if (diff !== 0) return diff;
  }
  if (leftPrerelease === rightPrerelease) return 0;
  if (!leftPrerelease) return 1;
  if (!rightPrerelease) return -1;
  const leftIdentifiers = leftPrerelease.split(".");
  const rightIdentifiers = rightPrerelease.split(".");
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const diff = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (diff !== 0) return diff;
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left.localeCompare(right);
}

function validPayloadPath(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1_024 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  );
}

function validUtc(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.endsWith("Z");
}

function validOptionalUtc(value: string | null): boolean {
  return value === null || validUtc(value);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}
