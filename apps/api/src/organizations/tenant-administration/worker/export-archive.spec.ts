import { createHash } from "node:crypto";

import {
  buildStoredZip,
  exportSourceRegistry,
  simulateExportCapacity,
  validateExportRegistryCoverage,
} from "./export-archive";
import {
  exportCapacityProfileFromEnvironment,
  verifyExportCapacityTarget,
} from "./tenant-export-capacity";

describe("tenant export archive", () => {
  it("creates a deterministic stored ZIP and hashes exact file bytes", () => {
    const archive = buildStoredZip([
      {
        path: "records/organization_profile.ndjson",
        bytes: Buffer.from('{"id":"o1"}\n'),
      },
      { path: "manifest.json", bytes: Buffer.from('{"formatVersion":1}\n') },
    ]);

    expect(archive.sha256).toBe(
      createHash("sha256").update(archive.bytes).digest("hex"),
    );
    expect(archive.bytes.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(archive.files).toEqual([
      expect.objectContaining({ path: "manifest.json", byteSize: 20 }),
      expect.objectContaining({
        path: "records/organization_profile.ndjson",
        byteSize: 12,
      }),
    ]);
  });

  it("rejects unsafe, duplicate, and non-deterministically ordered paths", () => {
    expect(() =>
      buildStoredZip([{ path: "../private.ndjson", bytes: Buffer.from("x") }]),
    ).toThrow("unsafe archive path");
    expect(() =>
      buildStoredZip([
        { path: "a.ndjson", bytes: Buffer.from("x") },
        { path: "a.ndjson", bytes: Buffer.from("y") },
      ]),
    ).toThrow("duplicate archive path");
  });

  it("requires all tenant-scoped tables to be registered or deliberately excluded", () => {
    expect(() =>
      validateExportRegistryCoverage([
        "organizations",
        "organization_members",
        "unregistered_tenant_table",
      ]),
    ).toThrow("unregistered_tenant_table");
    expect(() =>
      validateExportRegistryCoverage([
        ...exportSourceRegistry.flatMap((entry) => entry.tables),
      ]),
    ).not.toThrow();
  });

  it("keeps all persisted product-registry records in the product export source", () => {
    const productRegistry = exportSourceRegistry.find(
      (source) => source.sourceId === "product_registry",
    );

    expect(productRegistry?.tables).toEqual(
      expect.arrayContaining([
        "products",
        "product_releases",
        "product_release_market_availability",
        "product_regulatory_outbox_events",
      ]),
    );
  });

  it("models a resumable capacity profile against the 24-hour target", () => {
    expect(
      simulateExportCapacity({
        sourceCount: 16,
        averagePartBytes: 2_000_000,
        uploadBytesPerSecond: 1_000_000,
        partOverheadMs: 250,
        retryRate: 0.05,
        maxAttempts: 5,
        maximumArchiveBytes: 47_000_000,
      }),
    ).toMatchObject({ meetsTarget: true, resumeParts: 16 });
  });

  it("fails a capacity profile whose representative tenant cannot fit the configured ZIP ceiling", () => {
    const profile = {
      sourceCount: 400,
      averagePartBytes: 1_000_000,
      uploadBytesPerSecond: 1_000_000,
      partOverheadMs: 250,
      retryRate: 0.05,
      maxAttempts: 5,
      maximumArchiveBytes: 47_000_000,
    };
    expect(simulateExportCapacity(profile)).toMatchObject({
      fitsArchiveLimit: false,
      meetsTarget: false,
    });
    expect(() => verifyExportCapacityTarget(profile)).toThrow("24-hour target");
  });

  it("rejects an invalid capacity profile rather than inventing a transfer budget", () => {
    expect(() =>
      simulateExportCapacity({
        sourceCount: 0,
        averagePartBytes: 1,
        uploadBytesPerSecond: 1,
        partOverheadMs: 0,
        retryRate: 0,
        maxAttempts: 1,
        maximumArchiveBytes: 1,
      }),
    ).toThrow("invalid export capacity profile");
    expect(() =>
      simulateExportCapacity({
        sourceCount: 1,
        averagePartBytes: 1,
        uploadBytesPerSecond: 1,
        partOverheadMs: 0,
        retryRate: 1,
        maxAttempts: 1,
        maximumArchiveBytes: 1,
      }),
    ).toThrow("invalid export capacity profile");
  });

  it("requires a deployment capacity profile instead of baking a tenant size into CI", () => {
    const profile = exportCapacityProfileFromEnvironment({
      TENANT_EXPORT_CAPACITY_SOURCE_COUNT: "40",
      TENANT_EXPORT_CAPACITY_AVERAGE_PART_BYTES: "1000000",
      TENANT_EXPORT_CAPACITY_UPLOAD_BYTES_PER_SECOND: "1000000",
      TENANT_EXPORT_CAPACITY_PART_OVERHEAD_MS: "250",
      TENANT_EXPORT_CAPACITY_RETRY_RATE_PERCENT: "5",
      TENANT_EXPORT_CAPACITY_MAX_ATTEMPTS: "5",
      TENANT_EXPORT_MAX_ARCHIVE_BYTES: "47000000",
    });

    expect(verifyExportCapacityTarget(profile)).toMatchObject({
      meetsTarget: true,
      resumeParts: 40,
    });
    expect(() => exportCapacityProfileFromEnvironment({})).toThrow(
      "TENANT_EXPORT_CAPACITY_SOURCE_COUNT",
    );
    expect(() =>
      exportCapacityProfileFromEnvironment({
        TENANT_EXPORT_CAPACITY_SOURCE_COUNT: "1",
        TENANT_EXPORT_CAPACITY_AVERAGE_PART_BYTES: "1",
        TENANT_EXPORT_CAPACITY_UPLOAD_BYTES_PER_SECOND: "1",
        TENANT_EXPORT_CAPACITY_PART_OVERHEAD_MS: "1",
        TENANT_EXPORT_CAPACITY_RETRY_RATE_PERCENT: "100",
        TENANT_EXPORT_CAPACITY_MAX_ATTEMPTS: "1",
        TENANT_EXPORT_MAX_ARCHIVE_BYTES: "1",
      }),
    ).toThrow("TENANT_EXPORT_CAPACITY_RETRY_RATE_PERCENT");
  });
});
