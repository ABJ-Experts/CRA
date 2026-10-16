import { validateEnv } from "../config/env.validation";
const required = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_JWT_SECRET: "j".repeat(32),
  COOKIE_SIGNING_SECRET: "c".repeat(16),
};
describe("licensing environment", () => {
  it("keeps renewal/security available without a provisioned licence", () =>
    expect(validateEnv(required).LICENSING_INSTANCE_ID).toBeUndefined());
  it("rejects invalid binding/configuration", () => {
    expect(() =>
      validateEnv({ ...required, LICENSING_INSTANCE_ID: "wrong" }),
    ).toThrow("LICENSING_INSTANCE_ID");
    expect(() =>
      validateEnv({
        ...required,
        LICENSING_LOCAL_FEATURES_JSON: '{"unknown":true}',
      }),
    ).toThrow("LICENSING_LOCAL_FEATURES_JSON");
    expect(() =>
      validateEnv({
        ...required,
        LICENSING_LOCAL_FEATURES_JSON: '{"products":"true"}',
      }),
    ).toThrow("LICENSING_LOCAL_FEATURES_JSON");
  });
  it("restricts API-owned upload origin to HTTPS or local HTTP", () => {
    expect(() =>
      validateEnv({
        ...required,
        API_PUBLIC_ORIGIN: "http://external.example",
      }),
    ).toThrow("API_PUBLIC_ORIGIN");
    expect(
      validateEnv({ ...required, API_PUBLIC_ORIGIN: "http://localhost:3333" })
        .API_PUBLIC_ORIGIN,
    ).toBe("http://localhost:3333");
    expect(() =>
      validateEnv({
        ...required,
        API_PUBLIC_ORIGIN: "https://user:password@external.example",
      }),
    ).toThrow("API_PUBLIC_ORIGIN");
  });
  it("accepts deployment restrictions", () =>
    expect(
      validateEnv({
        ...required,
        LICENSING_INSTANCE_ID: "33333333-3333-4333-8333-333333333333",
        LICENSING_TRUST_FILE: "/run/licensing/trust.json",
        LICENSING_LOCAL_FEATURES_JSON: '{"products":false}',
      }).LICENSING_LOCAL_FEATURES_JSON,
    ).toBe('{"products":false}'));
});
