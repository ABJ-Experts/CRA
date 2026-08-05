// ADR-004: Supabase Auth behind a MANDATORY internal interface. No file outside
// this adapter imports the Supabase auth client. A later swap to Keycloak/Zitadel/
// Ory implements IdentityProvider; roles/permissions never come from JWT claims.
import { verify } from 'jsonwebtoken';
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JWTPayload,
} from 'jose';

export interface AuthenticatedIdentity {
  supabaseUserId: string;
  email: string;
  /** aal2 in the Supabase JWT => the session has completed MFA (FR-AUTH-002). */
  mfaSatisfied: boolean;
}

export interface SsoLinkInput {
  supabaseUserId: string;
  provider: string;
  externalId: string;
}

export interface ProvisionUserInput {
  email: string;
  displayName?: string;
}

export interface IdentityProvider {
  authenticate(bearerToken: string): Promise<AuthenticatedIdentity | null>;
  getSession(bearerToken: string): Promise<AuthenticatedIdentity | null>;
  revokeSession(sessionId: string): Promise<void>;
  linkSsoIdentity(input: SsoLinkInput): Promise<void>;
  provisionUser(input: ProvisionUserInput): Promise<{ supabaseUserId: string }>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

const V1 = 'TODO(V1): FR-AUTH-003/004/005 — SSO/SCIM lifecycle not in MVP';

export class SupabaseIdentityAdapter implements IdentityProvider {
  private readonly jwtSecret: string;
  // Supabase now signs sessions with asymmetric keys (ES256/RS256) served from a
  // JWKS endpoint; the legacy HS256 shared secret is still honoured (test tokens +
  // older projects). We verify against whichever the token header declares.
  private readonly jwks: ReturnType<typeof createRemoteJWKSet> | null;

  constructor(
    jwtSecret: string = process.env.SUPABASE_JWT_SECRET ?? '',
    supabaseUrl: string = process.env.SUPABASE_URL ?? '',
  ) {
    this.jwtSecret = jwtSecret;
    this.jwks = supabaseUrl
      ? createRemoteJWKSet(
          new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
        )
      : null;
  }

  authenticate(bearerToken: string): Promise<AuthenticatedIdentity | null> {
    return this.verifyToken(bearerToken);
  }

  getSession(bearerToken: string): Promise<AuthenticatedIdentity | null> {
    return this.verifyToken(bearerToken);
  }

  revokeSession(): Promise<void> {
    return Promise.reject(new Error(V1));
  }

  linkSsoIdentity(): Promise<void> {
    return Promise.reject(new Error(V1));
  }

  provisionUser(): Promise<{ supabaseUserId: string }> {
    return Promise.reject(new Error(V1));
  }

  private async verifyToken(
    bearerToken: string,
  ): Promise<AuthenticatedIdentity | null> {
    const token = bearerToken.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    try {
      const payload = await this.decodeVerified(token);
      if (!payload) return null;
      const sub = typeof payload.sub === 'string' ? payload.sub : null;
      if (!sub) return null;
      const email = typeof payload.email === 'string' ? payload.email : '';
      const aal = typeof payload.aal === 'string' ? payload.aal : undefined;
      return { supabaseUserId: sub, email, mfaSatisfied: aal === 'aal2' };
    } catch {
      // Any verification failure is an unauthenticated request, never a leak.
      return null;
    }
  }

  private async decodeVerified(token: string): Promise<JWTPayload | null> {
    const { alg } = decodeProtectedHeader(token);
    if (alg && alg !== 'HS256') {
      // Asymmetric: verify against the Supabase JWKS public keys.
      if (!this.jwks) return null;
      const { payload } = await jwtVerify(token, this.jwks);
      return payload;
    }
    // Symmetric HS256 shared secret (legacy Supabase config + test tokens).
    if (!this.jwtSecret) return null;
    return verify(token, this.jwtSecret) as unknown as JWTPayload;
  }
}
