import { jwtVerify } from "jose";

import type {
  TokenVerifierStrategy,
  VerifyResult,
} from "./token-verifier.strategy";

export class Hs256TokenVerifierStrategy implements TokenVerifierStrategy {
  readonly name = "HS256" as const;

  constructor(
    private readonly secret: Uint8Array,
    private readonly issuer: string,
  ) {}

  supports(algorithm: string): boolean {
    return algorithm === "HS256";
  }

  async verify(token: string): Promise<VerifyResult> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ["HS256"],
        issuer: this.issuer,
      });

      return { ok: true, claims: payload };
    } catch (error) {
      if ((error as { code?: string }).code === "ERR_JWT_EXPIRED") {
        return { ok: false, reason: "expired" };
      }

      return { ok: false, reason: "invalid" };
    }
  }
}
