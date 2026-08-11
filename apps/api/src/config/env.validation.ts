import { z } from "zod";

/**
 * Environment schema. Validated once at boot so a missing or malformed value
 * fails loudly on startup rather than as a confusing 500 on the first request
 * that happens to need it.
 *
 * The reference discovered the hard way that a mismatched JWT secret between
 * the API and the web middleware produces a silent 401 on every request with no
 * diagnostic anywhere, so `main.ts` logs a fingerprint of the resolved secret at
 * boot for exactly that comparison.
 */

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v === "true"));

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === "" ? fallback : Number.parseInt(v, 10),
    )
    .refine((n) => Number.isFinite(n) && n > 0, "must be a positive integer");

const boundedInt = (fallback: number, maximum: number, message: string) =>
  int(fallback).refine((value) => value <= maximum, message);

const fixedZero = z.coerce
  .number()
  .default(0)
  .refine((value) => value === 0, "must be exactly 0");

/**
 * Environment values arrive as strings. Unlike the legacy convenience parser,
 * policy switches must reject typos instead of silently weakening a security
 * control (for example, treating `enabled` as false).
 */
const strictBoolean = (fallback: boolean) =>
  z
    .preprocess(
      (value) => (value === "" ? undefined : value),
      z.enum(["true", "false"]).optional(),
    )
    .transform((value) => (value === undefined ? fallback : value === "true"));

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: int(3333),

  // --- Supabase ---------------------------------------------------------
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  /**
   * Bypasses RLS. Only ever used from the repository layer, never handed to
   * anything that takes a user-supplied organization id without checking it.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /**
   * Shared with apps/web's middleware, which verifies the access token locally
   * rather than calling the API on every navigation. If the two disagree, every
   * request 401s and nothing says why — hence the boot fingerprint.
   */
  SUPABASE_JWT_SECRET: z.string().min(32),

  // --- Web / CORS -------------------------------------------------------
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  /** Used to build links in outbound email. */
  APP_URL: z.string().url().default("http://localhost:3000"),

  // --- Cookies ----------------------------------------------------------
  /**
   * Left blank locally. When blank, Express writes a HOST-ONLY cookie, which is
   * what we want on localhost — setting `domain=localhost` is rejected by some
   * browsers and silently drops the cookie.
   */
  COOKIE_DOMAIN: z.string().optional().default(""),
  COOKIE_SECURE: bool(false),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  ACCESS_TOKEN_MAX_AGE: int(60 * 60), // 1h, matches config.toml jwt_expiry
  REFRESH_TOKEN_MAX_AGE: int(7 * 24 * 60 * 60), // 7d
  /** HMAC key for the signed active-organization cookie. */
  COOKIE_SIGNING_SECRET: z.string().min(16),

  // --- Mail -------------------------------------------------------------
  /**
   * Mailpit on 54324 has NO authentication. The reference requires
   * `host && user && pass` before it builds a transport, so a verbatim port
   * silently sends nothing locally and sign-up appears to hang forever at the
   * verify screen. Here, host alone is enough.
   */
  SMTP_HOST: z.string().optional().default("127.0.0.1"),
  SMTP_PORT: int(54325),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("CRA <no-reply@cra.test>"),

  // --- Security knobs ---------------------------------------------------
  LOGIN_MAX_ATTEMPTS: int(5),
  LOGIN_LOCK_MINUTES: int(15),
  OTP_TTL_MINUTES: int(15),
  RECOVERY_TTL_MINUTES: int(60),
  INVITATION_TTL_DAYS: int(7),
  // PostgreSQL owns worker authority; these only bound a process lease and
  // the current deterministic in-memory STORE-ZIP implementation.
  TENANT_LIFECYCLE_LEASE_SECONDS: boundedInt(
    60,
    3600,
    "must not exceed 3600 seconds",
  ),
  TENANT_EXPORT_MAX_ARCHIVE_BYTES: boundedInt(
    47_000_000,
    50_000_000,
    "must not exceed the private export bucket object limit",
  ),
  /**
   * With no scanner adapter configured, decoded raster-only inspection remains
   * available in non-strict environments and is recorded in the audit trail.
   * Strict deployments quarantine instead, so an invalid value must fail boot.
   */
  BRANDING_SCANNER_STRICT: strictBoolean(false),
  /**
   * Tolerance when comparing a JWT's `iat` against `users.session_epoch_at`.
   *
   * DEFAULTS TO 0, and that is deliberate. A positive skew opens a revocation
   * WINDOW: a token issued fewer than `skew` seconds before a sign-out survives
   * it, because `iat < epoch - skew` is false. The end-to-end flow caught
   * exactly that — "sign out everywhere" left the just-issued token working.
   *
   * The drift it was meant to absorb (GoTrue's clock vs Postgres's) only
   * matters for a session that should CONTINUE across an epoch bump, and the
   * only such flow is changing your password while signed in — which re-issues
   * cookies anyway. This is a fixed invariant rather than a tunable value.
   */
  SESSION_EPOCH_SKEW_SECONDS: fixedZero,
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return parsed.data;
}
