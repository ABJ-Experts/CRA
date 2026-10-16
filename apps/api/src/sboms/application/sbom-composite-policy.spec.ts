import {
  compositeIdentityFor,
  groupCompositeComponents,
  stableCompositeInputDigest,
} from "./sbom-composite-policy";

const component = (
  overrides: Partial<Parameters<typeof compositeIdentityFor>[0]> = {},
) => ({
  componentId: "00000000-0000-4000-8000-000000000001",
  documentId: "00000000-0000-4000-8000-000000000002",
  sourceId: "00000000-0000-4000-8000-000000000003",
  sourceDocumentHash: "a".repeat(64),
  sourceComponentRef: "pkg:npm/example@1.0.0",
  packageIdentity: "pkg:npm/example",
  normalizedVersion: "1.0.0",
  ...overrides,
});

describe("SBOM composite identity policy", () => {
  it("prefers the existing versionless package identity", () => {
    expect(compositeIdentityFor(component())).toEqual({
      kind: "package",
      value: "pkg:npm/example",
    });
  });

  it("does not collapse components without a stable identity", () => {
    const first = component({
      packageIdentity: null,
      canonicalCpe: null,
      componentHash: null,
    });
    const second = component({
      componentId: "00000000-0000-4000-8000-000000000004",
      packageIdentity: null,
      canonicalCpe: null,
      componentHash: null,
    });

    expect(groupCompositeComponents([first, second])).toHaveLength(2);
  });

  it("flags incompatible versions without selecting one", () => {
    const groups = groupCompositeComponents([
      component(),
      component({
        componentId: "00000000-0000-4000-8000-000000000004",
        normalizedVersion: "2.0.0",
      }),
    ]);

    expect(groups[0]).toMatchObject({
      duplicate: true,
      incompatibleVersions: true,
    });
  });

  it("uses an order-independent immutable input digest", () => {
    const left = stableCompositeInputDigest([
      { sourceId: "s2", documentId: "d2", sourceDocumentHash: "b" },
      { sourceId: "s1", documentId: "d1", sourceDocumentHash: "a" },
    ]);
    const right = stableCompositeInputDigest([
      { sourceId: "s1", documentId: "d1", sourceDocumentHash: "a" },
      { sourceId: "s2", documentId: "d2", sourceDocumentHash: "b" },
    ]);
    expect(left).toBe(right);
  });
});
