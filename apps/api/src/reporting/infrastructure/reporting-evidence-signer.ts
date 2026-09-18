import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  type KeyObject,
} from "node:crypto";

export type ReportingSigningKey = Readonly<{
  keyId: string;
  privateKey: string;
  publicKey: string;
}>;

export type ReportingVerificationKey = Readonly<{
  keyId: string;
  publicKey: string;
}>;

export class ReportingEvidenceSigningError extends Error {}

/**
 * A deliberately small Ed25519 boundary. Private material stays in process
 * configuration; database and browser contracts carry only key identifiers,
 * public keys, digests, and detached signatures.
 */
export class ReportingEvidenceSigner {
  constructor(private readonly active: ReportingSigningKey) {
    const privateKey = privateKeyObject(active.privateKey);
    const publicKey = publicKeyObject(active.publicKey);
    if (
      privateKey.asymmetricKeyType !== "ed25519" ||
      publicKey.asymmetricKeyType !== "ed25519" ||
      !active.keyId.trim()
    ) {
      throw new ReportingEvidenceSigningError("invalid reporting signing key");
    }
  }

  get keyId(): string {
    return this.active.keyId;
  }

  sign(bytes: Buffer): Readonly<{
    algorithm: "Ed25519";
    keyId: string;
    signature: Buffer;
    publicKeyFingerprint: string;
  }> {
    if (bytes.byteLength < 1) {
      throw new ReportingEvidenceSigningError("cannot sign empty evidence");
    }
    const publicKey = publicKeyObject(this.active.publicKey);
    return Object.freeze({
      algorithm: "Ed25519" as const,
      keyId: this.active.keyId,
      signature: sign(null, bytes, privateKeyObject(this.active.privateKey)),
      publicKeyFingerprint: createHash("sha256")
        .update(publicKey.export({ format: "der", type: "spki" }))
        .digest("hex"),
    });
  }

  verificationKeys(
    retained: readonly ReportingVerificationKey[],
  ): readonly ReportingVerificationKey[] {
    const keys = [
      { keyId: this.active.keyId, publicKey: this.active.publicKey },
      ...retained,
    ];
    const ids = new Set<string>();
    for (const key of keys) {
      if (!key.keyId.trim() || ids.has(key.keyId)) {
        throw new ReportingEvidenceSigningError("invalid verification key ring");
      }
      ids.add(key.keyId);
      if (publicKeyObject(key.publicKey).asymmetricKeyType !== "ed25519") {
        throw new ReportingEvidenceSigningError("invalid verification key");
      }
    }
    return Object.freeze(keys.map((key) => Object.freeze({ ...key })));
  }
}

function privateKeyObject(value: string): KeyObject {
  try {
    return createPrivateKey(normalizePem(value));
  } catch {
    throw new ReportingEvidenceSigningError("invalid reporting signing key");
  }
}

function publicKeyObject(value: string): KeyObject {
  try {
    return createPublicKey(normalizePem(value));
  } catch {
    throw new ReportingEvidenceSigningError("invalid reporting verification key");
  }
}

/**
 * dotenv normally expands `\\n` inside double quotes, but deployment secret
 * injectors frequently retain the escaped form. Accept both representations
 * at this server-only boundary without ever returning PEM material.
 */
function normalizePem(value: string): string {
  return value.replaceAll("\\n", "\n");
}
