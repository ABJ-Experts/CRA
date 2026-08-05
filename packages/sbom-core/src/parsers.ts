import {
  SbomParseError,
  type ComponentScope,
  type NormalizedComponent,
  type ParsedSbom,
  type SbomParser,
} from "./model";
import { ecosystemForPurlType, normaliseVersion, parsePurl } from "./purl";

// BFS depth from root refs over a ref -> children edge map. depth 0 = top-level.
function computeDepths(
  rootChildren: string[],
  edges: Map<string, string[]>,
): Map<string, number> {
  const depth = new Map<string, number>();
  let frontier = rootChildren;
  let d = 0;
  const seen = new Set<string>();
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const ref of frontier) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (!depth.has(ref)) depth.set(ref, d);
      for (const child of edges.get(ref) ?? [])
        if (!seen.has(child)) next.push(child);
    }
    frontier = next;
    d += 1;
  }
  return depth;
}

function normaliseFromParts(
  name: string,
  version: string | null,
  purl: string | null,
  cpe: string | null,
  scope: ComponentScope | null,
  supplierName: string | null,
  hashes: Record<string, string>,
  depth: number,
): NormalizedComponent {
  const parsed = purl ? parsePurl(purl) : null;
  const ecosystem = parsed ? ecosystemForPurlType(parsed.type) : null;
  const effectiveVersion = version ?? parsed?.version ?? null;
  return {
    purl,
    cpe,
    name,
    version: effectiveVersion,
    ecosystem,
    versionNormalised: normaliseVersion(effectiveVersion),
    depth,
    scope,
    supplierName,
    hashes,
  };
}

// ---- CycloneDX (JSON, 1.4 / 1.5 / 1.6) ------------------------------------
interface CdxComponent {
  type?: string;
  name?: string;
  version?: string;
  purl?: string;
  cpe?: string;
  scope?: string;
  "bom-ref"?: string;
  supplier?: { name?: string };
  hashes?: { alg?: string; content?: string }[];
}
interface CdxDoc {
  bomFormat?: string;
  specVersion?: string;
  serialNumber?: string;
  metadata?: { component?: { "bom-ref"?: string } };
  components?: CdxComponent[];
  dependencies?: { ref?: string; dependsOn?: string[] }[];
}

function scopeOf(value: string | undefined): ComponentScope | null {
  return value === "required" || value === "optional" || value === "excluded"
    ? value
    : null;
}

export class CycloneDxParser implements SbomParser {
  readonly format = "cyclonedx" as const;

  parse(raw: string): ParsedSbom {
    let doc: CdxDoc;
    try {
      doc = JSON.parse(raw) as CdxDoc;
    } catch {
      throw new SbomParseError("CycloneDX document is not valid JSON");
    }
    if (doc.bomFormat !== "CycloneDX") {
      throw new SbomParseError("Not a CycloneDX document (bomFormat mismatch)");
    }
    const components = doc.components ?? [];

    const edges = new Map<string, string[]>();
    for (const d of doc.dependencies ?? []) {
      if (d.ref) edges.set(d.ref, d.dependsOn ?? []);
    }
    const rootRef = doc.metadata?.component?.["bom-ref"];
    const rootChildren = rootRef ? (edges.get(rootRef) ?? []) : [];
    const depthByRef = computeDepths(rootChildren, edges);

    const normalized = components.map((c) => {
      const hashes: Record<string, string> = {};
      for (const h of c.hashes ?? [])
        if (h.alg && h.content) hashes[h.alg] = h.content;
      const ref = c["bom-ref"];
      const depth = ref !== undefined ? (depthByRef.get(ref) ?? 0) : 0;
      return normaliseFromParts(
        c.name ?? "(unnamed)",
        c.version ?? null,
        c.purl ?? null,
        c.cpe ?? null,
        scopeOf(c.scope),
        c.supplier?.name ?? null,
        hashes,
        depth,
      );
    });

    return buildResult(
      "cyclonedx",
      doc.specVersion ?? "unknown",
      doc.serialNumber ?? null,
      normalized,
    );
  }
}

// ---- SPDX (JSON, 2.2 / 2.3) ------------------------------------------------
interface SpdxExternalRef {
  referenceType?: string;
  referenceLocator?: string;
}
interface SpdxPackage {
  SPDXID?: string;
  name?: string;
  versionInfo?: string;
  supplier?: string;
  externalRefs?: SpdxExternalRef[];
}
interface SpdxDoc {
  spdxVersion?: string;
  documentNamespace?: string;
  packages?: SpdxPackage[];
  relationships?: {
    spdxElementId?: string;
    relationshipType?: string;
    relatedSpdxElement?: string;
  }[];
}

export class SpdxParser implements SbomParser {
  readonly format = "spdx" as const;

  parse(raw: string): ParsedSbom {
    let doc: SpdxDoc;
    try {
      doc = JSON.parse(raw) as SpdxDoc;
    } catch {
      throw new SbomParseError("SPDX document is not valid JSON");
    }
    if (!doc.spdxVersion?.startsWith("SPDX-")) {
      throw new SbomParseError("Not an SPDX document (spdxVersion missing)");
    }
    const packages = doc.packages ?? [];

    const edges = new Map<string, string[]>();
    const describes: string[] = [];
    for (const r of doc.relationships ?? []) {
      if (!r.spdxElementId || !r.relatedSpdxElement) continue;
      if (r.relationshipType === "DEPENDS_ON") {
        edges.set(r.spdxElementId, [
          ...(edges.get(r.spdxElementId) ?? []),
          r.relatedSpdxElement,
        ]);
      } else if (r.relationshipType === "DESCRIBES") {
        describes.push(r.relatedSpdxElement);
      }
    }
    // Top-level = packages the document describes; their deps are depth 0+.
    const rootChildren = describes.flatMap((ref) => edges.get(ref) ?? []);
    const depthByRef = computeDepths(
      rootChildren.length ? rootChildren : [],
      edges,
    );

    const normalized = packages.map((p) => {
      let purl: string | null = null;
      let cpe: string | null = null;
      for (const ref of p.externalRefs ?? []) {
        if (ref.referenceType === "purl" && ref.referenceLocator)
          purl = ref.referenceLocator;
        if (
          (ref.referenceType === "cpe23Type" ||
            ref.referenceType === "cpe22Type") &&
          ref.referenceLocator
        ) {
          cpe = ref.referenceLocator;
        }
      }
      const id = p.SPDXID;
      const depth = id !== undefined ? (depthByRef.get(id) ?? 0) : 0;
      const supplier =
        p.supplier && p.supplier !== "NOASSERTION" ? p.supplier : null;
      return normaliseFromParts(
        p.name ?? "(unnamed)",
        p.versionInfo && p.versionInfo !== "NOASSERTION" ? p.versionInfo : null,
        purl,
        cpe,
        null,
        supplier,
        {},
        depth,
      );
    });

    return buildResult(
      "spdx",
      doc.spdxVersion.replace("SPDX-", ""),
      doc.documentNamespace ?? null,
      normalized,
    );
  }
}

function buildResult(
  format: "cyclonedx" | "spdx",
  specVersion: string,
  serialNumber: string | null,
  components: NormalizedComponent[],
): ParsedSbom {
  return {
    format,
    specVersion,
    serialNumber,
    components,
    componentCount: components.length,
    depthMax: components.reduce((m, c) => Math.max(m, c.depth), 0),
  };
}
