import { createHash } from "node:crypto";

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from "jose";

/**
 * Verifies a Supabase access token locally.
 *
 * WHY LOCALLY, AND NOT `supabase.auth.getUser()`
 *   getUser() is a network round trip to GoTrue on every single authenticated
 *   request. Verifying the signature in-process is the difference between an
 *   auth check costing microseconds and costing a hop.
 *
 * WHY BOTH ALGORITHMS
 *   Supabase projects issue HS256 tokens signed with the shared JWT secret, but
 *   newer projects use asymmetric signing keys (ES256/RS256) published at
 *   `/auth/v1/.well-known/jwks.json`. Which one a given stack uses is not
 *   knowable until it runs. Guessing wrong means either every request pays for
 *   a network fallback or verification fails outright, so this resolves the
 *   strategy per token from the JWT header and logs which one it settled on at
 *   first use.
 *
 * NOTE: `jose` is pinned to v5 in package.json. v6 is ESM-only and this app
 * compiles to CommonJS under `module: NodeNext`, so v6 fails at RUNTIME with
 * ERR_REQUIRE_ESM — after a build that reported zero errors.
 */

export interface SupabaseJwtClaims extends JWTPayload {
  sub?: string;
  email?: string;
  role?: string;
  /** Authenticator assurance level: 'aal1' | 'aal2'. */
  aal?: string;
  session_id?: string;
}

export type VerifyResult =
  | { ok: true; claims: SupabaseJwtClaims }
  | { ok: false; reason: "expired" | "invalid" | "unavailable" };

@Injectable()
export class TokenVerifierService implements OnModuleInit {
  private readonly logger = new Logger(TokenVerifierService.name);

  private readonly secret: Uint8Array;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  private resolvedStrategy?: "HS256" | "JWKS";
  /** Counted so a silent degradation to the slower path is visible in logs. */
  private jwksVerifications = 0;

  constructor(private readonly config: ConfigService) {
    const url = this.config
      .getOrThrow<string>("SUPABASE_URL")
      .replace(/\/+$/, "");
    this.issuer = `${url}/auth/v1`;
    this.secret = new TextEncoder().encode(
      this.config.getOrThrow<string>("SUPABASE_JWT_SECRET"),
    );
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
  }

  onModuleInit(): void {
    /*
     * Log a FINGERPRINT of the secret, never the secret. apps/web's middleware
     * logs the same fingerprint. If the two differ, every request 401s and
     * nothing else in either process says why — the reference lost real time to
     * exactly this, which is why the two log lines exist to be compared.
     */
    this.logger.log(
      `[jwt] issuer=${this.issuer} secret-fingerprint=${this.fingerprint()}`,
    );
  }

  private fingerprint(): string {
    return createHash("sha256").update(this.secret).digest("hex").slice(0, 12);
  }

  async verify(token: string): Promise<VerifyResult> {
    let alg: string | undefined;
    try {
      alg = decodeProtectedHeader(token).alg;
    } catch {
      return { ok: false, reason: "invalid" };
    }

    const useJwks = alg !== undefined && alg !== "HS256";

    try {
      const { payload } = useJwks
        ? await jwtVerify(token, this.jwks, { issuer: this.issuer })
        : await jwtVerify(token, this.secret, { issuer: this.issuer });

      if (!this.resolvedStrategy) {
        this.resolvedStrategy = useJwks ? "JWKS" : "HS256";
        this.logger.log(
          `[jwt] verification strategy resolved: ${this.resolvedStrategy}`,
        );
      }
      if (useJwks) this.jwksVerifications += 1;

      // No assertion needed: JWTPayload carries an index signature, so it is
      // already assignable to SupabaseJwtClaims (whose extra fields are optional).
      return { ok: true, claims: payload };
    } catch (error) {
      const code = (error as { code?: string }).code;

      if (code === "ERR_JWT_EXPIRED") return { ok: false, reason: "expired" };

      /*
       * A JWKS fetch failure is NOT the caller's fault, and must not be reported
       * as a bad token — that would sign every user out of a healthy system
       * because one network call failed. It becomes a 503 upstream instead.
       */
      if (
        useJwks &&
        (code === "ERR_JWKS_TIMEOUT" ||
          code === "ERR_JWKS_NO_MATCHING_KEY" ||
          code === "ERR_JOSE_GENERIC")
      ) {
        this.logger.error(`[jwt] JWKS unavailable: ${String(code)}`);
        return { ok: false, reason: "unavailable" };
      }

      return { ok: false, reason: "invalid" };
    }
  }

  stats(): { strategy?: string; jwksVerifications: number } {
    return {
      strategy: this.resolvedStrategy,
      jwksVerifications: this.jwksVerifications,
    };
  }
}
