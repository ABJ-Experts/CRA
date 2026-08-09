import { jwtVerify, type JWTVerifyGetKey } from "jose";

import type {
  TokenVerifierStrategy,
  VerifyResult,
} from "./token-verifier.strategy";

const JWKS_UNAVAILABLE_CODES = new Set([
  "ERR_JWKS_TIMEOUT",
  "ERR_JWKS_NO_MATCHING_KEY",
  "ERR_JOSE_GENERIC",
]);

type UnavailableReporter = (code: string) => void;

export class JwksTokenVerifierStrategy implements TokenVerifierStrategy {
  readonly name = "JWKS" as const;

  constructor(
    private readonly getKey: JWTVerifyGetKey,
    private readonly issuer: string,
    private readonly reportUnavailable: UnavailableReporter = () => undefined,
  ) {}

  supports(algorithm: string): boolean {
    return algorithm === "ES256" || algorithm === "RS256";
  }

  async verify(token: string): Promise<VerifyResult> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        algorithms: ["ES256", "RS256"],
        issuer: this.issuer,
      });

      return { ok: true, claims: payload };
    } catch (error) {
      const code = (error as { code?: string }).code;

      if (code === "ERR_JWT_EXPIRED") {
        return { ok: false, reason: "expired" };
      }

      if (code && JWKS_UNAVAILABLE_CODES.has(code)) {
        this.reportUnavailable(code);
        return { ok: false, reason: "unavailable" };
      }

      return { ok: false, reason: "invalid" };
    }
  }
}
