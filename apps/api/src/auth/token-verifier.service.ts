import { createHash } from "node:crypto";

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, decodeProtectedHeader } from "jose";

import { Hs256TokenVerifierStrategy } from "./token-verification/hs256.strategy";
import { JwksTokenVerifierStrategy } from "./token-verification/jwks.strategy";
import { TokenStrategySelector } from "./token-verification/token-strategy-selector";
import type { VerifyResult } from "./token-verification/token-verifier.strategy";

export type {
  SupabaseJwtClaims,
  VerifyResult,
} from "./token-verification/token-verifier.strategy";

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

@Injectable()
export class TokenVerifierService implements OnModuleInit {
  private readonly logger = new Logger(TokenVerifierService.name);

  private readonly secret: Uint8Array;
  private readonly issuer: string;
  private readonly selector: TokenStrategySelector;

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
    const jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
    this.selector = new TokenStrategySelector([
      new Hs256TokenVerifierStrategy(this.secret, this.issuer),
      new JwksTokenVerifierStrategy(jwks, this.issuer, (code) => {
        this.logger.error(`[jwt] JWKS unavailable: ${code}`);
      }),
    ]);
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
    let algorithm: string | undefined;
    try {
      algorithm = decodeProtectedHeader(token).alg;
    } catch {
      return { ok: false, reason: "invalid" };
    }

    if (!algorithm) return { ok: false, reason: "invalid" };

    const strategy = this.selector.select(algorithm);
    if (!strategy) return { ok: false, reason: "invalid" };

    const result = await strategy.verify(token);
    if (!result.ok) return result;

    if (!this.resolvedStrategy) {
      this.resolvedStrategy = strategy.name;
      this.logger.log(
        `[jwt] verification strategy resolved: ${this.resolvedStrategy}`,
      );
    }
    if (strategy.name === "JWKS") this.jwksVerifications += 1;

    return { ok: true, claims: result.claims };
  }

  stats(): { strategy?: string; jwksVerifications: number } {
    return {
      strategy: this.resolvedStrategy,
      jwksVerifications: this.jwksVerifications,
    };
  }
}
