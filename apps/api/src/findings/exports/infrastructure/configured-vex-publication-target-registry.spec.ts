import { ConfiguredVexPublicationTargetRegistry } from "./configured-vex-publication-target-registry";

describe("ConfiguredVexPublicationTargetRegistry", () => {
  it("keeps safe registry metadata server-side and rejects arbitrary endpoints", () => {
    const registry = new ConfiguredVexPublicationTargetRegistry(
      JSON.stringify([
        {
          targetKey: "published-vex",
          label: "Published VEX",
          kind: "well_known",
          versionedUrlTemplate:
            "https://publish.example.test/vex/{organizationId}/{sha256}.json",
          pointerUrl: "https://publish.example.test/.well-known/vex.json",
          allowedHosts: ["publish.example.test"],
          credentialEnv: "VEX_PUBLISH_TOKEN",
        },
      ]),
    );
    expect(registry.find("published-vex")).toMatchObject({
      kind: "well_known",
    });
    expect(
      () =>
        new ConfiguredVexPublicationTargetRegistry(
          JSON.stringify([
            {
              targetKey: "bad",
              label: "Bad",
              kind: "https_put",
              versionedUrlTemplate:
                "http://127.0.0.1/{organizationId}/{sha256}",
              pointerUrl: "http://127.0.0.1/current",
              allowedHosts: ["127.0.0.1"],
            },
          ]),
        ),
    ).toThrow("invalid VEX publication target registry");
  });
});
