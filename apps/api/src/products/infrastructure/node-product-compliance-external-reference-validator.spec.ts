import { createHash } from "node:crypto";

import { NodeProductComplianceExternalReferenceValidator } from "./node-product-compliance-external-reference-validator";

const candidate = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Vendor security update",
  uri: "https://updates.example.test/releases/1.2.3",
};

describe("NodeProductComplianceExternalReferenceValidator", () => {
  it("promotes only a configured public hostname to a server-validated reference", async () => {
    const resolver = {
      lookup: jest.fn().mockResolvedValue([{ address: "8.8.8.8" }]),
    };
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test"],
      resolver,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    await expect(validator.validate([candidate])).resolves.toEqual({
      outcome: "validated",
      references: [
        {
          ...candidate,
          validationState: "validated_by_server",
          validatedAt: "2026-08-17T12:00:00.000Z",
        },
      ],
    });
    expect(resolver.lookup).toHaveBeenCalledWith("updates.example.test");
  });

  it("rejects a private-IP candidate without a fetch or DNS lookup", async () => {
    const resolver = { lookup: jest.fn() };
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test"],
      resolver,
    });

    await expect(
      validator.validate([{ ...candidate, uri: "https://127.0.0.1/update" }]),
    ).resolves.toEqual({ outcome: "invalid_reference" });
    expect(resolver.lookup).not.toHaveBeenCalled();
  });

  it("rejects URL credentials and non-default ports before any network activity", async () => {
    const resolver = { lookup: jest.fn() };
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test"],
      resolver,
    });

    await expect(
      validator.validate([
        { ...candidate, uri: "https://token@updates.example.test/release" },
      ]),
    ).resolves.toEqual({ outcome: "invalid_reference" });
    await expect(
      validator.validate([
        { ...candidate, uri: "https://updates.example.test:8443/release" },
      ]),
    ).resolves.toEqual({ outcome: "invalid_reference" });
    expect(resolver.lookup).not.toHaveBeenCalled();
  });

  it("rejects an allowlisted hostname that resolves to a private address", async () => {
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test"],
      resolver: {
        lookup: jest.fn().mockResolvedValue([{ address: "10.0.0.7" }]),
      },
    });

    await expect(validator.validate([candidate])).resolves.toEqual({
      outcome: "invalid_reference",
    });
  });

  it("rejects documentation and other reserved ranges even when DNS returns them", async () => {
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test"],
      resolver: {
        lookup: jest.fn().mockResolvedValue([{ address: "203.0.113.8" }]),
      },
    });

    await expect(validator.validate([candidate])).resolves.toEqual({
      outcome: "invalid_reference",
    });
  });

  it("fails closed when no deployment allowlist is configured", async () => {
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: [],
      resolver: {
        lookup: jest.fn().mockResolvedValue([{ address: "8.8.8.8" }]),
      },
    });

    await expect(validator.validate([candidate])).resolves.toEqual({
      outcome: "invalid_reference",
    });
  });

  it("pins a public DNS result, bounds the streamed fetch, and verifies the expected digest", async () => {
    const bytes = Buffer.from("verified external artifact");
    const fetcher = {
      get: jest.fn().mockResolvedValue(response(200, {}, [bytes])),
    };
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test"],
      resolver: {
        lookup: jest.fn().mockResolvedValue([{ address: "8.8.8.8" }]),
      },
      fetcher,
      maximumMonitorBytes: bytes.byteLength,
    });

    await expect(
      validator.monitor({
        candidates: [candidate],
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.byteLength,
      }),
    ).resolves.toEqual({ outcome: "verified" });
    expect(fetcher.get).toHaveBeenCalledWith(
      expect.objectContaining({ address: "8.8.8.8", family: 4 }),
    );
  });

  it("rechecks the allowlist and public DNS result at every redirect before fetching the next hop", async () => {
    const fetcher = {
      get: jest
        .fn()
        .mockResolvedValue(
          response(302, { location: "https://cdn.example.test/release" }),
        ),
    };
    const resolver = {
      lookup: jest
        .fn()
        .mockResolvedValueOnce([{ address: "8.8.8.8" }])
        .mockResolvedValueOnce([{ address: "127.0.0.1" }]),
    };
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test", "cdn.example.test"],
      resolver,
      fetcher,
    });

    await expect(
      validator.monitor({
        candidates: [candidate],
        sha256: "a".repeat(64),
        byteSize: 1,
      }),
    ).resolves.toEqual({ outcome: "external_content_changed" });
    expect(fetcher.get).toHaveBeenCalledTimes(1);
    expect(resolver.lookup).toHaveBeenNthCalledWith(1, "updates.example.test");
    expect(resolver.lookup).toHaveBeenNthCalledWith(2, "cdn.example.test");
  });

  it("marks expired external content as changed without consuming its response body", async () => {
    const expired = response(410, {}, [Buffer.from("not consumed")]);
    const fetcher = { get: jest.fn().mockResolvedValue(expired) };
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test"],
      resolver: {
        lookup: jest.fn().mockResolvedValue([{ address: "8.8.8.8" }]),
      },
      fetcher,
    });

    await expect(
      validator.monitor({
        candidates: [candidate],
        sha256: "a".repeat(64),
        byteSize: 1,
      }),
    ).resolves.toEqual({ outcome: "external_content_changed" });
    expect(expired.abort).toHaveBeenCalledTimes(1);
  });

  it("rejects a hash-correct external response with the wrong declared content type", async () => {
    const bytes = Buffer.from("verified external artifact");
    const mismatched = response(200, { "content-type": "text/plain" }, [bytes]);
    const validator = new NodeProductComplianceExternalReferenceValidator({
      allowedHosts: ["updates.example.test"],
      resolver: {
        lookup: jest.fn().mockResolvedValue([{ address: "8.8.8.8" }]),
      },
      fetcher: { get: jest.fn().mockResolvedValue(mismatched) },
    });

    await expect(
      validator.monitor({
        candidates: [candidate],
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.byteLength,
        contentType: "application/octet-stream",
      }),
    ).resolves.toEqual({ outcome: "type_mismatch" });
    expect(mismatched.abort).toHaveBeenCalledTimes(1);
  });
});

function response(
  statusCode: number,
  headers: Record<string, string> = {},
  chunks: readonly Uint8Array[] = [],
) {
  return {
    statusCode,
    headers,
    body: chunks,
    abort: jest.fn(),
  };
}
