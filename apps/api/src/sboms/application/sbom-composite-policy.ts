export { SBOM_COMPOSITE_MERGE_RULES_VERSION } from "@repo/contracts/sboms";

/**
 * Deterministic, provider-independent identity policy used while preparing a
 * composite review.  It deliberately does not compare semantic versions:
 * different non-null version strings are reviewable evidence, never an
 * opportunity for a source-order based "best" choice.
 */
export type CompositeComponentEvidence = Readonly<{
  componentId: string;
  documentId: string;
  sourceId: string;
  sourceDocumentHash: string;
  sourceComponentRef: string;
  packageIdentity?: string | null;
  canonicalPurl?: string | null;
  canonicalCpe?: string | null;
  componentHash?: string | null;
  normalizedVersion?: string | null;
}>;

export type CompositeIdentity = Readonly<{
  kind: "package" | "cpe" | "hash" | "unresolved";
  value: string;
}>;

export type CompositeIdentityGroup = Readonly<{
  identity: CompositeIdentity;
  components: readonly CompositeComponentEvidence[];
  duplicate: boolean;
  incompatibleVersions: boolean;
}>;

/**
 * Selects only stable normalized identities.  The fallback deliberately
 * contains the immutable source/document/component triple so unidentifiable
 * components cannot be silently collapsed just because their display names
 * happen to match.
 */
export function compositeIdentityFor(
  component: CompositeComponentEvidence,
): CompositeIdentity {
  if (nonEmpty(component.packageIdentity))
    return Object.freeze({ kind: "package", value: component.packageIdentity });
  if (nonEmpty(component.canonicalCpe))
    return Object.freeze({ kind: "cpe", value: component.canonicalCpe });
  if (nonEmpty(component.componentHash))
    return Object.freeze({ kind: "hash", value: component.componentHash });
  return Object.freeze({
    kind: "unresolved",
    value: `${component.sourceDocumentHash}:${component.sourceComponentRef}:${component.componentId}`,
  });
}

export function groupCompositeComponents(
  components: readonly CompositeComponentEvidence[],
): readonly CompositeIdentityGroup[] {
  const groups = new Map<string, CompositeComponentEvidence[]>();
  for (const component of components) {
    const identity = compositeIdentityFor(component);
    const key = `${identity.kind}:${identity.value}`;
    const current = groups.get(key) ?? [];
    groups.set(key, [...current, component]);
  }

  return Object.freeze(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => {
        const separator = key.indexOf(":");
        const identity = Object.freeze({
          kind: key.slice(0, separator) as CompositeIdentity["kind"],
          value: key.slice(separator + 1),
        });
        const ordered = Object.freeze(
          [...values].sort((left, right) =>
            stableEvidenceKey(left).localeCompare(stableEvidenceKey(right)),
          ),
        );
        const versions = new Set(
          ordered.flatMap((component) =>
            nonEmpty(component.normalizedVersion)
              ? [component.normalizedVersion]
              : [],
          ),
        );
        return Object.freeze({
          identity,
          components: ordered,
          duplicate: ordered.length > 1,
          incompatibleVersions: versions.size > 1,
        });
      }),
  );
}

export function stableCompositeInputDigest(
  inputs: readonly Readonly<{
    sourceId: string;
    documentId: string;
    sourceDocumentHash: string;
  }>[],
): string {
  return inputs
    .map(
      (input) =>
        `${input.sourceDocumentHash}:${input.sourceId}:${input.documentId}`,
    )
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function stableEvidenceKey(component: CompositeComponentEvidence): string {
  return `${component.sourceDocumentHash}:${component.sourceComponentRef}:${component.componentId}`;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
