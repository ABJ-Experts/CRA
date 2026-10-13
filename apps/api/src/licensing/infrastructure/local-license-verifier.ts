import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { compactVerify, decodeProtectedHeader, importJWK } from "jose";
import { z } from "zod";
import {
  licenseArtifactSchema,
  licenseClaimsSchema,
  type LicenseClaims,
} from "@repo/contracts/licensing";
import { LICENSE_GRACE_MS } from "../domain/license-policy";
const trustSchema = z
  .object({
    issuer: z.string().min(1).max(200),
    keys: z
      .array(
        z
          .object({
            kid: z.string().min(1).max(200),
            kty: z.literal("OKP"),
            crv: z.literal("Ed25519"),
            x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (trust) =>
      new Set(trust.keys.map((key) => key.kid)).size === trust.keys.length,
    "Duplicate trust key IDs",
  );
const headerSchema = z
  .object({
    alg: z.literal("EdDSA"),
    kid: z.string().min(1).max(200),
    typ: z.literal("CRA-LICENCE+JWS"),
  })
  .strict();
import { LicenseVerificationError } from "../domain/license-errors";
export { LicenseVerificationError } from "../domain/license-errors";
export interface LicenseBinding {
  organizationId: string;
  instanceId: string;
}
export interface VerifiedLicense {
  claims: LicenseClaims;
  digest: string;
  keyId: string;
}
export class LocalLicenseVerifier {
  readonly trustDigest: string;
  private readonly trust: z.output<typeof trustSchema>;
  constructor(trust: unknown) {
    this.trust = trustSchema.parse(trust);
    this.trustDigest = createHash("sha256")
      .update(
        JSON.stringify({
          ...this.trust,
          keys: [...this.trust.keys].sort((a, b) =>
            a.kid < b.kid ? -1 : a.kid > b.kid ? 1 : 0,
          ),
        }),
      )
      .digest("hex");
  }
  static async fromFile(path: string): Promise<LocalLicenseVerifier> {
    const content = await readFile(path, "utf8");
    if (Buffer.byteLength(content) > 65536)
      throw new LicenseVerificationError("invalid_trust_file");
    return new LocalLicenseVerifier(JSON.parse(content));
  }
  async verify(
    artifact: string,
    binding: LicenseBinding,
    now: Date,
    options: { activation?: boolean } = { activation: true },
  ): Promise<VerifiedLicense> {
    try {
      const serialized = licenseArtifactSchema.parse(artifact);
      const header = headerSchema.parse(decodeProtectedHeader(serialized));
      const key = this.trust.keys.find(
        (candidate) => candidate.kid === header.kid,
      );
      if (!key) throw new LicenseVerificationError("unknown_key");
      const verified = await compactVerify(
        serialized,
        await importJWK(key, "EdDSA"),
        { algorithms: ["EdDSA"] },
      );
      const claims = licenseClaimsSchema.parse(
        JSON.parse(
          new TextDecoder("utf8", { fatal: true }).decode(verified.payload),
        ),
      );
      if (claims.issuer !== this.trust.issuer)
        throw new LicenseVerificationError("wrong_issuer");
      if (
        claims.organizationId !== binding.organizationId ||
        claims.instanceId !== binding.instanceId
      )
        throw new LicenseVerificationError("wrong_binding");
      if (!Number.isFinite(now.getTime()))
        throw new LicenseVerificationError("invalid_time");
      if (options.activation !== false) {
        if (now.getTime() < Date.parse(claims.startsAt))
          throw new LicenseVerificationError("not_yet_active");
        if (now.getTime() >= Date.parse(claims.expiresAt) + LICENSE_GRACE_MS)
          throw new LicenseVerificationError("already_expired");
      }
      return {
        claims,
        digest: createHash("sha256").update(serialized).digest("hex"),
        keyId: header.kid,
      };
    } catch (error) {
      if (error instanceof LicenseVerificationError) throw error;
      throw new LicenseVerificationError("invalid_signature_or_artifact");
    }
  }
}
