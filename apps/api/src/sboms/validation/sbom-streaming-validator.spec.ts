import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSbomFile } from "./sbom-streaming-validator";

describe("bounded file SBOM validation", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cra-validator-test-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  async function validate(
    text: string,
    detected = { format: "cyclonedx-json" as const, specVersion: "1.6" },
  ) {
    const path = join(directory, "original");
    await writeFile(path, text);
    return validateSbomFile(path, detected);
  }
  it("rejects schema-invalid component types despite a valid extracted name", async () => {
    const result = await validate(
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        components: [{ type: "invented", name: "example" }],
      }),
    );
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.schemaAssetSha256).not.toBe("0".repeat(64));
  });
  it("validates root fields regardless of their ordering after components", async () => {
    expect(
      (
        await validate(
          '{"components":[{"type":"library","name":"ok"}],"bomFormat":"CycloneDX","specVersion":"1.6","version":0}',
        )
      ).errorCount,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          '{"components":[{"type":"library","name":"ok"}],"bomFormat":"CycloneDX","specVersion":"1.6"}',
        )
      ).errorCount,
    ).toBe(0);
  });
  it("rejects unrelated documents and unsupported versions", async () => {
    expect(
      (await validate("{}", { format: "cyclonedx-json", specVersion: "9.9" }))
        .errorCount,
    ).toBeGreaterThan(0);
  });
  it("rejects semantically duplicate array items despite reordered object keys", async () => {
    const result = await validate(
      JSON.stringify({
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        services: [
          { name: "x", endpoints: ["https://example.test"] },
          { endpoints: ["https://example.test"], name: "x" },
        ],
      }),
    );
    expect(result.errorCount).toBeGreaterThan(0);
  });
  it("validates XML through the pinned XSD with streaming native validation", async () => {
    const path = join(directory, "xml");
    await writeFile(
      path,
      '<bom xmlns="http://cyclonedx.org/schema/bom/1.6"><components><component type="invented"><name>ok</name></component></components></bom>',
    );
    expect(
      (
        await validateSbomFile(path, {
          format: "cyclonedx-xml",
          specVersion: "1.6",
        })
      ).errorCount,
    ).toBeGreaterThan(0);
  });
  it.each([
    "cyclonedx-1.4.json",
    "cyclonedx-1.5.json",
    "cyclonedx-1.6.json",
    "cyclonedx-1.4.xml",
    "cyclonedx-1.5.xml",
    "cyclonedx-1.6.xml",
    "spdx-2.2.json",
    "spdx-2.3.json",
    "spdx-3.0.json",
    "spdx-2.2.spdx",
    "spdx-2.3.spdx",
  ])("accepts the pinned supported fixture %s", async (fixture) => {
    const file = join(__dirname, "fixtures", fixture);
    const version = fixture.split("-")[1]!.slice(0, 3);
    const format = fixture.endsWith("xml")
      ? "cyclonedx-xml"
      : fixture.endsWith("spdx")
        ? "spdx-tag-value"
        : fixture.startsWith("cyclonedx")
          ? "cyclonedx-json"
          : version === "3.0"
            ? "spdx-json-ld"
            : "spdx-json";
    expect(
      (await validateSbomFile(file, { format, specVersion: version }))
        .errorCount,
    ).toBe(0);
  });
});
