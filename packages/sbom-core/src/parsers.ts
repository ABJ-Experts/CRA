import {
  SbomParseError,
  type ComponentScope,
  type NormalizedComponent,
  type ParsedSbom,
  type SbomParser,
} from "./model";
import { ecosystemForPurlType, normaliseVersion, parsePurl } from "./purl";
import { XMLParser } from "fast-xml-parser";

// BFS depth from root refs over a ref -> children edge map. depth 0 = top-level.
function computeDepths(rootChildren: string[], edges: Map<string, string[]>): Map<string, number> {
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
      for (const child of edges.get(ref) ?? []) if (!seen.has(child)) next.push(child);
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
  return value === "required" || value === "optional" || value === "excluded" ? value : null;
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
    if (!new Set(["1.4", "1.5", "1.6"]).has(doc.specVersion ?? "")) {
      throw new SbomParseError(
        `Unsupported CycloneDX JSON version ${doc.specVersion ?? "unknown"}`,
      );
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
      for (const h of c.hashes ?? []) if (h.alg && h.content) hashes[h.alg] = h.content;
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

type XmlNode = string | number | boolean | XmlRecord | XmlNode[] | undefined;
interface XmlRecord {
  [key: string]: XmlNode;
}

function xmlRecord(value: XmlNode): XmlRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as XmlRecord) : {};
}

function xmlValues(value: XmlNode): XmlNode[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function xmlText(value: XmlNode): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null;
  const node = xmlRecord(value);
  const text = node["#text"];
  return typeof text === "string" || typeof text === "number" ? String(text).trim() || null : null;
}

function cycloneDxXmlVersion(bom: XmlRecord): string {
  const namespaces = Object.entries(bom)
    .filter(([key]) => key === "@_xmlns" || key.startsWith("@_xmlns:"))
    .map(([, value]) => String(value));
  const version = namespaces
    .map((namespace) => namespace.match(/\/bom\/(\d+\.\d+)/)?.[1])
    .find(Boolean);
  return version ?? "unknown";
}

/**
 * CycloneDX XML adapter. The normalised output intentionally matches the JSON
 * adapter so downstream matching never needs to know the source syntax.
 */
export class CycloneDxXmlParser implements SbomParser {
  readonly format = "cyclonedx" as const;

  parse(raw: string): ParsedSbom {
    let parsed: XmlRecord;
    try {
      parsed = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        // Keep xmlns attributes: their schema URL carries the CycloneDX version.
        removeNSPrefix: false,
        trimValues: true,
      }).parse(raw) as XmlRecord;
    } catch {
      throw new SbomParseError("CycloneDX document is not valid XML");
    }

    const bom = xmlRecord(parsed.bom);
    if (Object.keys(bom).length === 0) {
      throw new SbomParseError("Not a CycloneDX XML document (bom missing)");
    }

    const specVersion = cycloneDxXmlVersion(bom);
    if (!new Set(["1.4", "1.5", "1.6"]).has(specVersion)) {
      throw new SbomParseError(`Unsupported CycloneDX XML version ${specVersion}`);
    }

    const dependencies = new Map<string, string[]>();
    for (const value of xmlValues(xmlRecord(bom.dependencies).dependency)) {
      const dependency = xmlRecord(value);
      const ref = xmlText(dependency["@_ref"]);
      if (!ref) continue;
      dependencies.set(
        ref,
        xmlValues(dependency.dependency)
          .map((child) => xmlText(xmlRecord(child)["@_ref"]))
          .filter((child): child is string => Boolean(child)),
      );
    }

    const metadata = xmlRecord(bom.metadata);
    const rootRef = xmlText(xmlRecord(metadata.component)["@_bom-ref"]);
    const depths = computeDepths(rootRef ? (dependencies.get(rootRef) ?? []) : [], dependencies);
    const components = xmlValues(xmlRecord(bom.components).component).map((value) => {
      const component = xmlRecord(value);
      const hashes: Record<string, string> = {};
      for (const hashValue of xmlValues(xmlRecord(component.hashes).hash)) {
        const hash = xmlRecord(hashValue);
        const algorithm = xmlText(hash["@_alg"]);
        const content = xmlText(hash);
        if (algorithm && content) hashes[algorithm] = content;
      }
      const ref = xmlText(component["@_bom-ref"]);
      return normaliseFromParts(
        xmlText(component.name) ?? "(unnamed)",
        xmlText(component.version),
        xmlText(component.purl),
        xmlText(component.cpe),
        scopeOf(xmlText(component.scope) ?? undefined),
        xmlText(xmlRecord(component.supplier).name),
        hashes,
        ref ? (depths.get(ref) ?? 0) : 0,
      );
    });

    return buildResult("cyclonedx", specVersion, xmlText(bom["@_serialNumber"]), components);
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
    if (doc.spdxVersion === "SPDX-3.0")
      return parseSpdx3Json(doc as unknown as Record<string, unknown>);
    if (!new Set(["SPDX-2.2", "SPDX-2.3"]).has(doc.spdxVersion)) {
      throw new SbomParseError(`Unsupported SPDX JSON version ${doc.spdxVersion}`);
    }
    const packages = doc.packages ?? [];

    const edges = new Map<string, string[]>();
    const describes: string[] = [];
    for (const r of doc.relationships ?? []) {
      if (!r.spdxElementId || !r.relatedSpdxElement) continue;
      if (r.relationshipType === "DEPENDS_ON") {
        edges.set(r.spdxElementId, [...(edges.get(r.spdxElementId) ?? []), r.relatedSpdxElement]);
      } else if (r.relationshipType === "DESCRIBES") {
        describes.push(r.relatedSpdxElement);
      }
    }
    // Top-level = packages the document describes; their deps are depth 0+.
    const rootChildren = describes.flatMap((ref) => edges.get(ref) ?? []);
    const depthByRef = computeDepths(rootChildren.length ? rootChildren : [], edges);

    const normalized = packages.map((p) => {
      let purl: string | null = null;
      let cpe: string | null = null;
      for (const ref of p.externalRefs ?? []) {
        if (ref.referenceType === "purl" && ref.referenceLocator) purl = ref.referenceLocator;
        if (
          (ref.referenceType === "cpe23Type" || ref.referenceType === "cpe22Type") &&
          ref.referenceLocator
        ) {
          cpe = ref.referenceLocator;
        }
      }
      const id = p.SPDXID;
      const depth = id !== undefined ? (depthByRef.get(id) ?? 0) : 0;
      const supplier = p.supplier && p.supplier !== "NOASSERTION" ? p.supplier : null;
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

function stringProperty(node: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function recordValues(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
      )
    : [];
}

/** Minimal SPDX 3 JSON-LD adapter for the Software profile's package nodes. */
function parseSpdx3Json(document: Record<string, unknown>): ParsedSbom {
  const nodes = recordValues(document["@graph"]);
  const packageNodes = nodes.filter((node) => {
    const type = stringProperty(node, ["type", "@type"]);
    return Boolean(type && /(?:software[_-]?)?package/i.test(type));
  });
  const components = packageNodes.map((node) => {
    const identifiers = recordValues(node.externalIdentifier ?? node.externalIdentifiers);
    const purl =
      identifiers
        .filter((identifier) =>
          /(?:packageurl|purl)/i.test(
            stringProperty(identifier, ["externalIdentifierType", "type"]) ?? "",
          ),
        )
        .map((identifier) =>
          stringProperty(identifier, ["identifier", "locator", "externalIdentifier"]),
        )
        .find((identifier): identifier is string => Boolean(identifier)) ?? null;
    const cpe =
      identifiers
        .filter((identifier) =>
          /cpe/i.test(stringProperty(identifier, ["externalIdentifierType", "type"]) ?? ""),
        )
        .map((identifier) =>
          stringProperty(identifier, ["identifier", "locator", "externalIdentifier"]),
        )
        .find((identifier): identifier is string => Boolean(identifier)) ?? null;
    return normaliseFromParts(
      stringProperty(node, ["name", "softwarePackageName"]) ?? "(unnamed)",
      stringProperty(node, ["softwarePackageVersion", "version"]),
      purl,
      cpe,
      null,
      null,
      {},
      0,
    );
  });
  return buildResult(
    "spdx",
    "3.0",
    stringProperty(document, ["documentNamespace", "namespace"]),
    components,
  );
}

interface TagValuePackage {
  id: string;
  name: string;
  version: string | null;
  supplier: string | null;
  purl: string | null;
  cpe: string | null;
}

function parseTagValue(raw: string): {
  version: string;
  namespace: string | null;
  packages: TagValuePackage[];
  relationships: Array<{ from: string; type: string; to: string }>;
} {
  const fields = raw.split(/\r?\n/).reduce<Record<string, string[]>>((all, line) => {
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
    const key = match?.[1];
    if (!key) return all;
    const value = match[2] ?? "";
    return { ...all, [key]: [...(all[key] ?? []), value] };
  }, {});
  const version = fields.SPDXVersion?.[0]?.replace(/^SPDX-/, "") ?? "";
  if (!new Set(["2.2", "2.3", "3.0"]).has(version)) {
    throw new SbomParseError(`Unsupported SPDX tag-value version ${version || "unknown"}`);
  }

  const blocks = raw.split(/\r?\n\s*\r?\n/);
  const packages = blocks.flatMap((block) => {
    const packageName = block.match(/^PackageName:\s*(.+)$/m)?.[1]?.trim();
    const id = block.match(/^SPDXID:\s*(.+)$/m)?.[1]?.trim();
    if (!packageName || !id) return [];
    const externalRefs = [...block.matchAll(/^ExternalRef:\s+(.+)$/gm)].map(
      (match) => match[1] ?? "",
    );
    const purl =
      externalRefs.map((ref) => ref.match(/^PACKAGE-MANAGER\s+purl\s+(.+)$/i)?.[1]).find(Boolean) ??
      null;
    const cpe =
      externalRefs.map((ref) => ref.match(/^SECURITY\s+cpe23Type\s+(.+)$/i)?.[1]).find(Boolean) ??
      null;
    const supplier = block.match(/^PackageSupplier:\s*(.+)$/m)?.[1]?.trim() ?? null;
    const versionInfo = block.match(/^PackageVersion:\s*(.+)$/m)?.[1]?.trim() ?? null;
    return [{ id, name: packageName, version: versionInfo, supplier, purl, cpe }];
  });
  const relationships = (fields.Relationship ?? []).flatMap((value) => {
    const [from, type, to] = value.trim().split(/\s+/, 3);
    return from && type && to ? [{ from, type, to }] : [];
  });
  return {
    version,
    namespace: fields.DocumentNamespace?.[0] ?? null,
    packages,
    relationships,
  };
}

/** SPDX tag-value adapter for SPDX 2.2/2.3 and the BRD's 3.0 input promise. */
export class SpdxTagValueParser implements SbomParser {
  readonly format = "spdx" as const;

  parse(raw: string): ParsedSbom {
    const document = parseTagValue(raw);
    const edges = new Map<string, string[]>();
    const describes: string[] = [];
    for (const relationship of document.relationships) {
      if (relationship.type === "DEPENDS_ON") {
        edges.set(relationship.from, [...(edges.get(relationship.from) ?? []), relationship.to]);
      }
      if (relationship.type === "DESCRIBES") describes.push(relationship.to);
    }
    const roots = describes.flatMap((reference) => edges.get(reference) ?? []);
    const depths = computeDepths(roots, edges);
    return buildResult(
      "spdx",
      document.version,
      document.namespace,
      document.packages.map((pkg) =>
        normaliseFromParts(
          pkg.name,
          pkg.version && pkg.version !== "NOASSERTION" ? pkg.version : null,
          pkg.purl,
          pkg.cpe,
          null,
          pkg.supplier && pkg.supplier !== "NOASSERTION" ? pkg.supplier : null,
          {},
          depths.get(pkg.id) ?? 0,
        ),
      ),
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
