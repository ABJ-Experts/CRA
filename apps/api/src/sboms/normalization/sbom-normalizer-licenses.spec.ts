import { Readable } from "node:stream";
import { normalizeSbomStream, NORMALIZER_VERSION } from "./sbom-normalizer";
const options = { maximumBytes: 100_000, maximumComponents: 100 };
const normalize = (value: unknown) =>
  normalizeSbomStream(
    Readable.from([
      Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
    ]),
    options,
  );
const json = (licenses: unknown[]) => ({
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  components: [
    { type: "library", name: "library", "bom-ref": "library", licenses },
  ],
});
describe("CycloneDX native license declarations", () => {
  it.each([
    [[{ license: { id: "MIT" } }], ["MIT"]],
    [[{ expression: "MIT OR Apache-2.0" }], ["MIT OR Apache-2.0"]],
    [[{ license: { name: "Customer license" } }], ["Customer license"]],
    [
      [{ license: { expression: "MIT AND Apache-2.0" } }],
      ["MIT AND Apache-2.0"],
    ],
    [
      [
        { license: { id: "MIT" } },
        { license: { id: "MIT" } },
        { license: { name: "Customer license" } },
      ],
      ["MIT", "Customer license"],
    ],
  ])("retains JSON licenses %j", async (licenses, expected) => {
    const result = await normalize(json(licenses));
    expect(result.components[0]).toMatchObject({
      licenseExpression: expected[0],
      licenseValues: expected,
    });
  });
  it("uses the same JSON extraction for primary and nested components", async () => {
    const result = await normalize({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      metadata: {
        component: {
          type: "application",
          name: "Product",
          "bom-ref": "primary",
          licenses: [{ license: { id: "MIT" } }],
        },
      },
      components: [
        {
          type: "library",
          name: "Parent",
          "bom-ref": "parent",
          components: [
            {
              type: "library",
              name: "Nested",
              "bom-ref": "nested",
              licenses: [{ expression: "Apache-2.0" }],
            },
          ],
        },
      ],
    });
    expect(
      result.components.find((c) => c.localRef === "primary")?.licenseValues,
    ).toEqual(["MIT"]);
    expect(
      result.components.find((c) => c.localRef === "nested")?.licenseValues,
    ).toEqual(["Apache-2.0"]);
  });
  it.each([
    ["<license><id>MIT</id></license>", ["MIT"]],
    ["<expression>MIT OR Apache-2.0</expression>", ["MIT OR Apache-2.0"]],
    ["<license><name>Customer license</name></license>", ["Customer license"]],
    [
      "<license><expression>MIT AND Apache-2.0</expression></license>",
      ["MIT AND Apache-2.0"],
    ],
    ["<license><id>MIT</id></license><license><id>MIT</id></license>", ["MIT"]],
  ])("retains XML licenses %s", async (licenses, expected) => {
    const result = await normalize(
      `<bom xmlns="http://cyclonedx.org/schema/bom/1.6"><components><component type="library" bom-ref="library"><name>Library</name><licenses>${licenses}</licenses></component></components></bom>`,
    );
    expect(result.components[0]).toMatchObject({
      licenseExpression: expected[0],
      licenseValues: expected,
    });
  });
  it("uses the same XML extraction for primary and nested components", async () => {
    const result = await normalize(
      '<bom xmlns="http://cyclonedx.org/schema/bom/1.6"><metadata><component type="application" bom-ref="primary"><name>Primary</name><licenses><license><id>MIT</id></license></licenses></component></metadata><components><component type="library" bom-ref="parent"><name>Parent</name><components><component type="library" bom-ref="nested"><name>Nested</name><licenses><expression>Apache-2.0</expression></licenses></component></components></component></components></bom>',
    );
    expect(
      result.components.find((c) => c.localRef === "primary")?.licenseValues,
    ).toEqual(["MIT"]);
    expect(
      result.components.find((c) => c.localRef === "nested")?.licenseValues,
    ).toEqual(["Apache-2.0"]);
  });
  it("retains the bounded 20 distinct license limit after deduplication", async () => {
    const values = Array.from({ length: 20 }, (_, i) => ({
      license: { id: `LicenseRef-${i}` },
    }));
    expect(
      (await normalize(json([...values, ...values]))).components[0]
        ?.licenseValues,
    ).toHaveLength(20);
    await expect(
      normalize(json([...values, { license: { id: "LicenseRef-21" } }])),
    ).rejects.toThrow("normalized persistence");
  });
  it("applies the same bounded distinct license limit to XML", async () => {
    const values = Array.from(
      { length: 20 },
      (_, i) => `<license><id>LicenseRef-${i}</id></license>`,
    ).join("");
    const xml = (licenses: string) =>
      `<bom xmlns="http://cyclonedx.org/schema/bom/1.6"><components><component type="library" bom-ref="library"><name>Library</name><licenses>${licenses}</licenses></component></components></bom>`;
    expect(
      (await normalize(xml(values + values))).components[0]?.licenseValues,
    ).toHaveLength(20);
    await expect(
      normalize(xml(values + "<license><id>LicenseRef-21</id></license>")),
    ).rejects.toThrow("normalized persistence");
  });
  it("pins new graphs to the repaired license extraction policy", () => {
    expect(NORMALIZER_VERSION).toBe("m3-03.3");
  });
});
