import { Readable } from "node:stream";
import { extractBsiProfileFacts } from "./bsi-profile-extractor";
const options = {
  format: "spdx" as const,
  serialization: "json" as const,
  specificationVersion: "2.3",
};
describe("bounded native graph facts", () => {
  it("collects a large direct dependency star without dropping references", async () => {
    const count = 5000;
    async function* parts() {
      await Promise.resolve();
      yield Buffer.from(
        '{"packages":[{"SPDXID":"root","name":"root"}],"relationships":[',
      );
      for (let index = 0; index < count; index++)
        yield Buffer.from(
          (index === 0 ? "" : ",") +
            JSON.stringify({
              spdxElementId: "root",
              relationshipType: "DEPENDS_ON",
              relatedSpdxElement: `dependency-${index}`,
            }),
        );
      yield Buffer.from("]}");
    }
    const facts = await extractBsiProfileFacts(Readable.from(parts()), options);
    expect(facts.components[0]?.dependencies).toHaveLength(count);
    expect(facts.components[0]?.dependencies?.at(-1)).toBe(
      `dependency-${count - 1}`,
    );
  });
  it("retains native BOM-Link declarations without classifying arbitrary missing IDs as links", async () => {
    const reference =
      "urn:cdx:11111111-1111-4111-8111-111111111111/1#component";
    const body = {
      components: [
        {
          "bom-ref": "a",
          name: "a",
          externalReferences: [
            { type: "bom", url: "https://bom.test/explicit" },
          ],
        },
      ],
      dependencies: [
        { ref: "a", dependsOn: [reference, "https://random.test/unlinked"] },
      ],
    };
    const facts = await extractBsiProfileFacts(
      Readable.from([Buffer.from(JSON.stringify(body))]),
      { ...options, format: "cyclonedx", specificationVersion: "1.6" },
    );
    expect(facts.externalBomLinks).toEqual(
      expect.arrayContaining([
        reference,
        reference.split("#")[0],
        "https://bom.test/explicit",
      ]),
    );
    expect(facts.externalBomLinks).not.toContain(
      "https://random.test/unlinked",
    );
  });
});
