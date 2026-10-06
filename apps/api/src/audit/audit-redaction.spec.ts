import { redactAuditMetadata } from "./audit-redaction";

describe("redactAuditMetadata", () => {
  it("preserves approved references and replaces secret-bearing content", () => {
    const result = redactAuditMetadata({
      productId: "7e23d4ba-1774-442b-9bcd-a39788192185",
      promptVersion: "m9-05-v1",
      password: "secret-canary",
      unknown: "secret-canary",
      sourceSpan: { quote: "secret-canary" },
      signedUrl: "https://example.test/?token=secret-canary",
    });

    expect(result).toEqual({
      productId: "7e23d4ba-1774-442b-9bcd-a39788192185",
      promptVersion: "m9-05-v1",
      password: "[REDACTED]",
      unknown: "[REDACTED]",
      sourceSpan: "[REDACTED]",
      signedUrl: "[REDACTED]",
    });
    expect(JSON.stringify(result)).not.toContain("secret-canary");
  });

  it("does not retain arbitrary nested values or raw reasons", () => {
    expect(
      redactAuditMetadata({ before: { otp: "123456" }, reason: "my password" }),
    ).toEqual({ before: "[REDACTED]", reason: "[REDACTED]" });
  });

  it("retains only bounded structural metadata", () => {
    expect(redactAuditMetadata(null)).toBeNull();
    expect(
      redactAuditMetadata({
        attemptCount: 2,
        version: -1,
        active: true,
        status: "approved",
        model: "local-ollama",
        productId: "bad-id",
        sourceId: "7e23d4ba-1774-442b-9bcd-a39788192185",
      }),
    ).toEqual({
      attemptCount: 2,
      version: "[REDACTED]",
      active: true,
      status: "approved",
      model: "local-ollama",
      productId: "[REDACTED]",
      sourceId: "7e23d4ba-1774-442b-9bcd-a39788192185",
    });
    expect(
      Object.keys(
        redactAuditMetadata(
          Object.fromEntries(
            Array.from({ length: 100 }, (_, index) => [
              `field${index}`,
              "secret",
            ]),
          ),
        ) ?? {},
      ),
    ).toHaveLength(64);
  });
});
