import { validateEnv } from "./env.validation";

const required = Object.freeze({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_JWT_SECRET: "j".repeat(32),
  COOKIE_SIGNING_SECRET: "c".repeat(16),
});

describe("environment validation", () => {
  it("applies secure local defaults", () => {
    expect(validateEnv(required)).toMatchObject({
      NODE_ENV: "development",
      PORT: 3333,
      WEB_ORIGIN: "http://localhost:3000",
      APP_URL: "http://localhost:3000",
      COOKIE_DOMAIN: "",
      COOKIE_SECURE: false,
      COOKIE_SAMESITE: "lax",
      ACCESS_TOKEN_MAX_AGE: 3600,
      REFRESH_TOKEN_MAX_AGE: 604800,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: 54325,
      SMTP_FROM: "CRA <no-reply@cra.test>",
      LOGIN_MAX_ATTEMPTS: 5,
      LOGIN_LOCK_MINUTES: 15,
      OTP_TTL_MINUTES: 15,
      RECOVERY_TTL_MINUTES: 60,
      INVITATION_TTL_DAYS: 7,
      SESSION_EPOCH_SKEW_SECONDS: 0,
      TENANT_LIFECYCLE_LEASE_SECONDS: 60,
      TENANT_EXPORT_MAX_ARCHIVE_BYTES: 47_000_000,
    });
  });

  it("parses explicit deployment values", () => {
    expect(
      validateEnv({
        ...required,
        NODE_ENV: "production",
        PORT: "8080",
        WEB_ORIGIN: "https://web.cra.test",
        APP_URL: "https://cra.test",
        COOKIE_DOMAIN: ".cra.test",
        COOKIE_SECURE: "true",
        COOKIE_SAMESITE: "strict",
        ACCESS_TOKEN_MAX_AGE: "1800",
        REFRESH_TOKEN_MAX_AGE: "7200",
        SMTP_HOST: "smtp.cra.test",
        SMTP_PORT: "2525",
        SMTP_USER: "mailer",
        SMTP_PASS: "secret",
        SMTP_FROM: "CRA <mail@cra.test>",
        LOGIN_MAX_ATTEMPTS: "8",
        LOGIN_LOCK_MINUTES: "20",
        OTP_TTL_MINUTES: "10",
        RECOVERY_TTL_MINUTES: "45",
        INVITATION_TTL_DAYS: "14",
        SESSION_EPOCH_SKEW_SECONDS: "0",
      }),
    ).toMatchObject({
      NODE_ENV: "production",
      PORT: 8080,
      COOKIE_SECURE: true,
      ACCESS_TOKEN_MAX_AGE: 1800,
      SMTP_PORT: 2525,
      LOGIN_MAX_ATTEMPTS: 8,
      SESSION_EPOCH_SKEW_SECONDS: 0,
    });
  });

  it("treats blank optional numeric and boolean values as defaults", () => {
    expect(
      validateEnv({
        ...required,
        PORT: "",
        COOKIE_SECURE: "",
        SESSION_EPOCH_SKEW_SECONDS: "",
      }),
    ).toMatchObject({
      PORT: 3333,
      COOKIE_SECURE: false,
      SESSION_EPOCH_SKEW_SECONDS: 0,
    });
  });

  it("rejects malformed and unsafe configuration with actionable paths", () => {
    expect(() =>
      validateEnv({
        ...required,
        SUPABASE_URL: "not-a-url",
        PORT: "0",
        SESSION_EPOCH_SKEW_SECONDS: "-1",
      }),
    ).toThrow(
      new Error(
        "Invalid environment configuration:\n" +
          "  - PORT: must be a positive integer\n" +
          "  - SUPABASE_URL: Invalid URL\n" +
          "  - SESSION_EPOCH_SKEW_SECONDS: must be exactly 0",
      ),
    );
  });

  it("rejects non-numeric positive integer settings", () => {
    expect(() =>
      validateEnv({ ...required, LOGIN_MAX_ATTEMPTS: "many" }),
    ).toThrow("LOGIN_MAX_ATTEMPTS: must be a positive integer");
  });

  it("rejects any session revocation grace window", () => {
    expect(() =>
      validateEnv({ ...required, SESSION_EPOCH_SKEW_SECONDS: "1" }),
    ).toThrow("SESSION_EPOCH_SKEW_SECONDS: must be exactly 0");
  });

  it("bounds the configured lifecycle worker lease and in-memory archive ceiling", () => {
    expect(() =>
      validateEnv({
        ...required,
        TENANT_LIFECYCLE_LEASE_SECONDS: "3601",
        TENANT_EXPORT_MAX_ARCHIVE_BYTES: "50000001",
      }),
    ).toThrow("TENANT_LIFECYCLE_LEASE_SECONDS: must not exceed 3600 seconds");
  });
});
