import type { JWTPayload } from "jose";

export interface SupabaseJwtClaims extends JWTPayload {
  sub?: string;
  email?: string;
  role?: string;
  /** Authenticator assurance level: "aal1" | "aal2". */
  aal?: string;
  session_id?: string;
}

export type VerifyResult =
  | { ok: true; claims: SupabaseJwtClaims }
  | { ok: false; reason: "expired" | "invalid" | "unavailable" };

export interface TokenVerifierStrategy {
  readonly name: "HS256" | "JWKS";
  supports(algorithm: string): boolean;
  verify(token: string): Promise<VerifyResult>;
}
