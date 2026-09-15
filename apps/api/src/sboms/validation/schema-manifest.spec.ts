import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SCHEMA_ASSET_MANIFEST,
  SCHEMA_ASSET_ROOT,
  VALIDATOR_VERSION,
} from "./schema-manifest";

describe("SCHEMA_ASSET_MANIFEST", () => {
  it("records vendored official schema provenance and exact SHA-256 values", () => {
    expect(VALIDATOR_VERSION).toMatch(/^m3-02\./);
    expect(SCHEMA_ASSET_MANIFEST).toHaveLength(12);
    expect(SCHEMA_ASSET_MANIFEST.map((asset) => asset.id)).toEqual([
      "cyclonedx-1.4-json",
      "cyclonedx-1.4-xml",
      "cyclonedx-1.5-json",
      "cyclonedx-1.5-xml",
      "cyclonedx-1.6-json",
      "cyclonedx-1.6-xml",
      "cyclonedx-spdx-license-json",
      "cyclonedx-jsf-json",
      "spdx-2.2-json",
      "spdx-2.3-json",
      "spdx-3.0-jsonld-context",
      "spdx-3.0-jsonld-example",
    ]);

    for (const asset of SCHEMA_ASSET_MANIFEST) {
      expect(asset.validatorVersion).toBe(VALIDATOR_VERSION);
      expect(asset.upstreamUrl).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\//,
      );
      expect(asset.upstreamRef).toMatch(/\S/);
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(sha256(readFileSync(join(SCHEMA_ASSET_ROOT, asset.path)))).toBe(
        asset.sha256,
      );
    }
  });
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
