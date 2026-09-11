import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OPENVEX_020_SCHEMA_ASSET,
  VexExportValidationError,
  validateVexExport,
} from "./vex-export-validation";

describe("M5-06 VEX validation assets", () => {
  it("pins the official OpenVEX 0.2.0 schema bytes", () => {
    const bytes = readFileSync(
      join(__dirname, "assets", "openvex-0.2.0.schema.json"),
    );

    expect(OPENVEX_020_SCHEMA_ASSET.specificationVersion).toBe("0.2.0");
    expect(OPENVEX_020_SCHEMA_ASSET.upstreamUrl).toMatch(/^https:\/\//);
    expect(OPENVEX_020_SCHEMA_ASSET.upstreamRef).toMatch(/\S/);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      OPENVEX_020_SCHEMA_ASSET.sha256,
    );
  });

  it("uses the pinned schema to reject malformed OpenVEX output safely", () => {
    expect(() => validateVexExport("openvex", { statements: [] })).toThrow(
      VexExportValidationError,
    );
  });
});
