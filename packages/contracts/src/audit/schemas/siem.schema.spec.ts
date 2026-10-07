import { describe, it, expect } from "vitest";
import {
  siemCreateDestinationSchema,
  siemCredentialSchema,
  siemEventSchema,
  siemCredentialInputSchema,
  siemPageQuerySchema,
} from "./siem.schema.js";
const id = "fcd0e5e9-99ea-48c3-8327-c6be3176855c";
const config = {
  requestId: id,
  destinationId: id,
  name: "Collector",
  transport: "https",
  format: "json",
  endpoint: "https://collector.example.test/events",
  eventClasses: ["access_control"],
  productIds: [],
};
describe("SIEM boundaries", () => {
  it("enforces the installed vault and bearer transport limits", () => {
    expect(
      siemCredentialSchema.safeParse({
        mode: "bearer",
        token: "a".repeat(4097),
      }).success,
    ).toBe(false);
    expect(
      siemCredentialSchema.safeParse({
        mode: "bearer",
        token: "a".repeat(4096),
      }).success,
    ).toBe(true);
    const pem = (content: string) =>
      `-----BEGIN CERTIFICATE-----\n${content}\n-----END CERTIFICATE-----`;
    expect(
      siemCredentialSchema.safeParse({
        mode: "mtls",
        certificate: pem("a".repeat(10000)),
        privateKey: pem("b".repeat(10000)),
      }).success,
    ).toBe(false);
    expect(
      siemCredentialSchema.safeParse({
        mode: "mtls",
        certificate: pem("😀".repeat(2600)),
        privateKey: pem("😀".repeat(2600)),
      }).success,
    ).toBe(false);
    expect(
      siemCredentialSchema.safeParse({
        mode: "mtls",
        certificate: pem("a".repeat(100)),
        privateKey: pem("b".repeat(100)),
      }).success,
    ).toBe(true);
  });

  it("rejects tenant injection and insecure endpoints", () => {
    expect(
      siemCreateDestinationSchema.safeParse({ ...config, organizationId: id })
        .success,
    ).toBe(false);
    for (const endpoint of [
      "http://collector.example.test",
      "https://127.0.0.1",
      "https://localhost",
      "https://u:p@collector.example.test",
      "https://collector.example.test?a=secret",
    ])
      expect(
        siemCreateDestinationSchema.safeParse({ ...config, endpoint }).success,
      ).toBe(false);
    expect(siemCreateDestinationSchema.parse(config).transport).toBe("https");
  });
  it("requires explicit product subset and transport parity", () => {
    expect(
      siemCreateDestinationSchema.safeParse({
        ...config,
        eventClasses: ["products"],
      }).success,
    ).toBe(false);
    expect(
      siemCreateDestinationSchema.safeParse({
        ...config,
        transport: "syslog_tls",
      }).success,
    ).toBe(false);
    expect(
      siemCreateDestinationSchema.parse({
        ...config,
        transport: "syslog_tls",
        endpoint: "tls://collector.example.test:6514",
      }).transport,
    ).toBe("syslog_tls");
  });
  it("rejects secret or private-content event fields", () => {
    expect(
      siemEventSchema.safeParse({ before: { secret: "canary" } }).success,
    ).toBe(false);
  });
  it("rejects newline bearer material and bounds pages", () => {
    expect(
      siemCredentialInputSchema.safeParse({
        requestId: id,
        expectedVersion: 0,
        credential: { mode: "bearer", token: "bad\r\ntoken" },
      }).success,
    ).toBe(false);
    expect(siemPageQuerySchema.parse({ requestId: id }).limit).toBe(50);
    expect(
      siemPageQuerySchema.safeParse({ requestId: id, limit: 201 }).success,
    ).toBe(false);
  });
});
