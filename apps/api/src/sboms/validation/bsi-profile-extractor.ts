import { Readable } from "node:stream";
import { readBsiJson, readBsiXml } from "./bsi-profile-source-reader";
import type {
  BsiComponentFacts,
  BsiFactsExtractor,
  BsiProfileFacts,
} from "../quality/bsi-profile-facts";
import { SbomStreamSourceError } from "../normalization/sbom-normalization-error";

type ObjectValue = Record<string, unknown>;
type Pending = Readonly<{
  facts: BsiComponentFacts;
  creatorRefs: readonly string[];
  hashRefs: readonly string[];
}>;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const array = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
const strings = (value: unknown): string[] =>
  array(value).flatMap((item) => (text(item) ? [text(item)!] : []));
const unique = (values: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(values)]);
const uri = (value: unknown): string | null => {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    return new URL(candidate).protocol === "javascript:" ? null : candidate;
  } catch {
    return null;
  }
};
function contacts(value: unknown): readonly string[] {
  return unique(
    array(value).flatMap((item) => {
      if (typeof item === "string") {
        if (/^Tool:/iu.test(item.trimStart())) return [];
        const emails =
          item.match(
            /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
          ) ?? [];
        const urls = item.match(/https?:\/\/[^\s<>"')]+/giu) ?? [];
        return [...emails, ...urls];
      }
      const entry = object(item);
      return [
        ...contacts(entry.email),
        ...array(entry.url).flatMap((url) => (uri(url) ? [uri(url)!] : [])),
        ...contacts(entry.contact),
        ...contacts(entry.contacts),
      ];
    }),
  );
}
function filename(value: unknown): string | null {
  const name = text(value);
  if (!name) return null;
  return name.replaceAll("\\", "/").split("/").at(-1) || null;
}
function licenses(value: unknown): string[] {
  return array(value).flatMap((item) => {
    const entry = object(item),
      license = object(entry.license);
    const name = text(
      typeof item === "string"
        ? item
        : (entry.expression ??
            license.id ??
            license.name ??
            entry.simplelicensing_licenseExpression),
    );
    return name && !["NONE", "NOASSERTION"].includes(name) ? [name] : [];
  });
}
function sha512(value: unknown): readonly string[] {
  return unique(
    array(value).flatMap((item) => {
      const hash = object(item),
        algorithm = text(hash.alg ?? hash.algorithm)
          ?.replaceAll("-", "")
          .replaceAll("_", "")
          .toLowerCase();
      const digest = text(hash.content ?? hash.checksumValue ?? hash.hashValue);
      return algorithm === "sha512" &&
        digest &&
        /^[a-f0-9]{128}$/iu.test(digest)
        ? [digest]
        : [];
    }),
  );
}

/** Extract native declarations only; a successful result requires verified EOF. */
export const extractBsiProfileFacts: BsiFactsExtractor = async (
  input,
  options,
) => {
  const maximumBytes = options.maximumBytes ?? 100 * 1024 * 1024,
    maximumComponents = options.maximumComponents ?? 50_000;
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 100 * 1024 * 1024 ||
    !Number.isSafeInteger(maximumComponents) ||
    maximumComponents < 1 ||
    maximumComponents > 50_000
  )
    throw new Error("Invalid BSI extraction bounds.");
  const collector = new FactsCollector(
    options,
    maximumComponents,
    maximumBytes,
  );
  let bytes = 0;
  const source = Readable.from(
    (async function* () {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        for await (const chunk of input as AsyncIterable<Uint8Array>) {
          bytes += chunk.byteLength;
          if (bytes > maximumBytes)
            throw new Error("BSI original byte ceiling exceeded.");
          for (let offset = 0; offset < chunk.byteLength; offset += 16 * 1024) {
            const part = chunk.subarray(offset, offset + 16 * 1024);
            decoder.decode(part, { stream: true });
            if (options.onProgress) await options.onProgress(bytes);
            yield part;
          }
        }
        decoder.decode();
      } finally {
        input.destroy();
      }
    })(),
  );
  try {
    if (options.serialization === "json" || options.serialization === "json_ld")
      await readBsiJson(source, collector);
    else if (options.serialization === "xml")
      await readBsiXml(source, collector);
    else {
      for await (const chunk of source) void chunk;
      collector.limitation(
        "Native profile metadata is unavailable for tag-value serialization.",
      );
    }
    return collector.finish();
  } catch (error) {
    throw error instanceof SbomStreamSourceError ? error.sourceError : error;
  } finally {
    source.destroy();
    input.destroy();
  }
};

class FactsCollector {
  private readonly pending: Pending[] = [];
  private readonly dependencies = new Map<string, Set<string> | null>();
  private readonly agents = new Map<string, readonly string[]>();
  private readonly hashes = new Map<string, readonly string[]>();
  private readonly licenseExpressions = new Map<string, readonly string[]>();
  private readonly licenseRoles = new Map<
    string,
    Readonly<{ declared: readonly string[]; concluded: readonly string[] }>
  >();
  private readonly creation = new Map<
    string,
    Readonly<{ creatorRefs: readonly string[]; timestamp: string | null }>
  >();
  private readonly sbomRoots = new Map<string, readonly string[]>();
  private readonly issues = new Set<string>();
  private readonly ambiguousReferences = new Set<string>();
  private readonly externalLinks = new Set<string>();
  private readonly externalDocumentReferences = new Set<string>();
  private retainedBytes = 0;
  private records = 0;
  private creatorContacts: readonly string[] = [];
  private timestamp: string | null = null;
  private documentUri: string | null = null;
  private primary: string | null = null;
  private documentCreation: string | null = null;
  private documentNodes = 0;
  private documentVersion: string | null = null;
  private readonly ambiguousCreation = new Set<string>();
  private documentRoots: readonly string[] = [];
  private embedded = false;
  constructor(
    private readonly options: Parameters<BsiFactsExtractor>[1],
    private readonly maximumComponents: number,
    private readonly maximumBytes: number,
  ) {}
  limitation(message: string): void {
    if (this.issues.size < 100) this.issues.add(message);
  }
  root(key: string, value: unknown): void {
    if (key === "metadata") {
      const metadata = object(value);
      this.creatorContacts = unique([
        ...contacts(metadata.authors),
        ...contacts(metadata.manufacturer),
      ]);
      this.timestamp = text(metadata.timestamp);
    } else if (key === "creationInfo") {
      const creation = object(value);
      this.creatorContacts = contacts(creation.creators);
      this.timestamp = text(creation.created);
    } else if (key === "version")
      this.documentVersion =
        typeof value === "number" ? String(value) : text(value);
    else if (key === "serialNumber" || key === "documentNamespace")
      this.documentUri = uri(value);
  }
  consume(
    path: readonly string[],
    value: unknown,
    offset: number,
    xml = false,
    exactSourcePath?: string,
  ): void {
    if (++this.records > this.maximumComponents * 10 + 1000)
      throw new Error("BSI record ceiling exceeded.");
    const node = object(value),
      kind = path.at(-2),
      sourcePath =
        exactSourcePath ??
        (xml
          ? `${path.join(".")}@${offset}`
          : `$.${path.join(".").replaceAll(".[]", "")}@${offset}`);
    if (sourcePath.length > 1000)
      throw new Error("BSI source location ceiling exceeded.");
    if (
      kind === "components" ||
      path.join(".") === "metadata.component" ||
      (xml && path.at(-1) === "component")
    ) {
      const facts = this.cycloneDx(node, sourcePath, offset);
      if (path.includes("metadata")) this.primary = facts.reference;
      this.add({ facts, creatorRefs: [], hashRefs: [] });
    } else if (kind === "packages" || kind === "files")
      this.add({
        facts: this.spdx2(node, sourcePath, offset),
        creatorRefs: [],
        hashRefs: [],
      });
    else if (kind === "@graph") this.spdx3(node, sourcePath, offset);
    else if (kind === "dependencies" || (xml && path.at(-1) === "dependency")) {
      const ref = text(node.ref),
        values = node.dependsOn;
      if (ref)
        this.setDependencies(
          ref,
          Array.isArray(values) ? strings(values) : null,
        );
    } else if (kind === "relationships") this.relationship(node, false);
    else if (
      kind === "vulnerabilities" ||
      (xml && path.at(-1) === "vulnerability")
    )
      this.embedded = true;
    else if (kind === "externalReferences") {
      if (node.type === "bom" && uri(node.url))
        this.externalLinks.add(uri(node.url)!);
    } else if (kind === "externalDocumentRefs") {
      const link = uri(node.spdxDocument);
      if (link) {
        this.externalLinks.add(link);
        const identifier = text(node.externalDocumentId);
        if (identifier && /^DocumentRef-[A-Za-z0-9.-]+$/.test(identifier))
          this.externalDocumentReferences.add(identifier);
      }
    }
  }
  private add(item: Pending): void {
    if (this.pending.length >= this.maximumComponents)
      throw new Error("BSI component ceiling exceeded.");
    this.retainedBytes += Buffer.byteLength(JSON.stringify(item));
    if (this.retainedBytes > this.maximumBytes)
      throw new Error("BSI retained fact ceiling exceeded.");
    this.pending.push(item);
  }
  private properties(node: ObjectValue): Map<string, readonly string[]> {
    const result = new Map<string, readonly string[]>();
    for (const property of array(node.properties)) {
      const entry = object(property),
        name = text(entry.name),
        value = text(entry.value);
      if (name && value && name.startsWith("bsi:component:")) {
        result.set(name, unique([...(result.get(name) ?? []), value]));
      }
    }
    return result;
  }
  private base(
    node: ObjectValue,
    sourcePath: string,
    reference: string,
    creatorContacts: readonly string[],
    name: string | null,
    version: string | null,
    nativeFilename: string | null,
  ): BsiComponentFacts {
    const properties = this.properties(node);
    const convention = (key: string): string | null => {
      const values = properties.get(`bsi:component:${key}`);
      if (values && values.length > 1)
        this.limitation(
          `Representation convention has conflicting ${key} declarations.`,
        );
      return values?.length === 1 ? values[0]! : null;
    };
    const flag = (key: string): boolean | null => {
      const values = properties.get(`bsi:component:${key}`);
      if (!values) return null;
      const aliases: Readonly<Record<string, boolean>> = {
        true: true,
        false: false,
        executable: true,
        "non-executable": false,
        archive: true,
        "no archive": false,
        structured: true,
        unstructured: false,
      };
      const allowed =
        key === "executable"
          ? ["true", "false", "executable", "non-executable"]
          : key === "archive"
            ? ["true", "false", "archive", "no archive"]
            : key === "structured"
              ? ["true", "false", "structured", "unstructured"]
              : ["true", "false"];
      const mapped = values.map((value) =>
        allowed.includes(value) ? aliases[value] : undefined,
      );
      if (
        mapped.some((value) => value === undefined) ||
        new Set(mapped).size !== 1
      ) {
        this.limitation(
          `Representation convention has conflicting or unsupported ${key} declarations.`,
        );
        return null;
      }
      return mapped[0]!;
    };
    const unavailable =
      convention("unavailableFields")
        ?.split(",")
        .map((value) => value.trim()) ?? [];
    const knownUnavailable = unavailable.filter((value) =>
      [
        "filename",
        "sha512",
        "creatorContacts",
        "name",
        "version",
        "dependencies",
        "associatedLicenses",
      ].includes(value),
    );
    if (unavailable.length > 20)
      throw new Error("BSI unavailable-field declaration ceiling exceeded.");
    if (unavailable.length > 0)
      this.limitation(
        "Explicit assembly unavailable-field declarations require technical review; they do not prove an exception.",
      );
    const refs = array(node.externalReferences).map(object);
    for (const ref of refs)
      if (ref.type === "bom" && uri(ref.url))
        this.externalLinks.add(uri(ref.url)!);
    const declaredFilename = convention("filename");
    const file = properties.has("bsi:component:filename")
      ? declaredFilename
      : nativeFilename;
    return Object.freeze({
      reference,
      sourcePath,
      creatorContacts: unique(creatorContacts),
      name,
      version,
      filename: file,
      sha512: [],
      dependencies: null,
      associatedLicenses: unique(licenses(convention("associatedLicenses"))),
      concludedLicenses: [],
      declaredLicenses: [],
      executable: flag("executable"),
      archive: flag("archive"),
      structured: flag("structured"),
      sourceCodeUris: unique(
        refs
          .filter(
            (ref) => ref.type === "vcs" || ref.type === "source-distribution",
          )
          .flatMap((ref) => (uri(ref.url) ? [uri(ref.url)!] : [])),
      ),
      deployableUris: unique(
        refs
          .filter((ref) => ref.type === "distribution")
          .flatMap((ref) => (uri(ref.url) ? [uri(ref.url)!] : [])),
      ),
      identifiers: unique(
        [
          text(node.purl),
          text(node.cpe),
          text(node.software_packageUrl),
        ].filter((item): item is string => item !== null),
      ),
      inDeliveryScope: flag("inDeliveryScope"),
      unavailableFields: unique(knownUnavailable),
      uncertainFields: unique([
        ...((properties.get("bsi:component:filename")?.length ?? 0) > 1
          ? ["filename"]
          : []),
        ...(["executable", "archive", "structured"] as const).filter(
          (key) => properties.has(`bsi:component:${key}`) && flag(key) === null,
        ),
      ]),
    });
  }
  private cycloneDx(
    node: ObjectValue,
    path: string,
    offset: number,
  ): BsiComponentFacts {
    const base = this.base(
      node,
      path,
      text(node["bom-ref"]) ?? `component-${offset}`,
      unique([
        ...contacts(node.authors),
        ...contacts(node.author),
        ...contacts(node.manufacturer),
      ]),
      text(node.name),
      text(node.version),
      node.type === "file" ? filename(node.name) : null,
    );
    const entries = array(node.licenses).map(object);
    const role = (entry: ObjectValue): unknown =>
      entry.acknowledgement ?? object(entry.license).acknowledgement;
    if (entries.some((item) => role(item) === undefined))
      this.limitation(
        "CycloneDX license role is unspecified; associated licensing requires explicit review.",
      );
    return Object.freeze({
      ...base,
      uncertainFields: unique([
        ...(base.uncertainFields ?? []),
        ...(base.associatedLicenses.length === 0 &&
        entries.some((item) => role(item) === undefined)
          ? ["associatedLicenses"]
          : []),
      ]),
      sha512: sha512(node.hashes),
      associatedLicenses: unique([...base.associatedLicenses]),
      declaredLicenses: unique(
        licenses(entries.filter((item) => role(item) === "declared")),
      ),
      concludedLicenses: unique(
        licenses(entries.filter((item) => role(item) === "concluded")),
      ),
    });
  }
  private spdx2(
    node: ObjectValue,
    path: string,
    offset: number,
  ): BsiComponentFacts {
    const base = this.base(
      node,
      path,
      text(node.SPDXID) ?? `component-${offset}`,
      contacts(node.originator),
      text(node.name),
      text(node.versionInfo),
      filename(node.packageFileName ?? node.fileName),
    );
    return Object.freeze({
      ...base,
      sha512: sha512(node.checksums),
      declaredLicenses: unique(licenses(node.licenseDeclared)),
      concludedLicenses: unique(licenses(node.licenseConcluded)),
      sourceCodeUris: unique(
        [text(node.sourceInfo)].filter(
          (item): item is string => item !== null && uri(item) !== null,
        ),
      ),
      deployableUris: unique(
        [uri(node.downloadLocation)].filter(
          (item): item is string => item !== null,
        ),
      ),
      identifiers: unique([
        ...base.identifiers,
        ...array(node.externalRefs).flatMap((item) => {
          const ref = object(item);
          return [text(ref.referenceLocator)].filter(
            (value): value is string => value !== null,
          );
        }),
      ]),
    });
  }
  private spdx3(node: ObjectValue, path: string, offset: number): void {
    const type = text(node.type),
      id = text(node.spdxId ?? node["@id"]);
    if (
      type?.startsWith("security_") &&
      type.toLowerCase().includes("vulnerab")
    )
      this.embedded = true;
    if (type === "software_Package" || type === "software_File") {
      const base = this.base(
        node,
        path,
        id ?? `component-${offset}`,
        [],
        text(node.name),
        text(node.software_packageVersion),
        type === "software_File" ? filename(node.name) : null,
      );
      this.add({
        facts: base,
        creatorRefs: strings(node.originatedBy),
        hashRefs: strings(node.verifiedUsing),
      });
    } else if (type === "Person" || type === "Organization") {
      if (id) this.putUnique(this.agents, id, contacts(node.name));
    } else if (type === "Hash") {
      if (id) this.putUnique(this.hashes, id, sha512(node));
    } else if (type === "simplelicensing_LicenseExpression") {
      if (id)
        this.putUnique(
          this.licenseExpressions,
          id,
          licenses(node.simplelicensing_licenseExpression),
        );
    } else if (type === "CreationInfo") {
      if (id) {
        if (this.creation.has(id) || this.ambiguousCreation.has(id)) {
          this.ambiguousCreation.add(id);
          this.creation.delete(id);
          this.limitation("Ambiguous SPDX creation metadata.");
        } else
          this.creation.set(id, {
            creatorRefs: strings(node.createdBy),
            timestamp: text(node.created),
          });
      }
    } else if (type === "SpdxDocument") {
      if (++this.documentNodes > 1) {
        this.limitation(
          "Multiple SPDX document nodes make document metadata ambiguous.",
        );
        this.documentUri = null;
        this.documentCreation = null;
        this.documentRoots = [];
        this.primary = null;
        return;
      }
      this.documentUri = uri(id);
      this.documentCreation = text(node.creationInfo);
      this.documentRoots = strings(node.rootElement);
    } else if (type === "software_Sbom" && id)
      this.putUnique(this.sbomRoots, id, strings(node.rootElement));
    else if (type === "Relationship") this.relationship(node, true);
  }
  private putUnique(
    map: Map<string, readonly string[]>,
    id: string,
    values: readonly string[],
  ): void {
    const previous = map.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(values)) {
      map.set(id, []);
      this.ambiguousReferences.add(id);
      this.limitation("Ambiguous SPDX referenced metadata.");
    } else if (!map.has(id)) map.set(id, values);
  }
  private setDependencies(ref: string, values: readonly string[] | null): void {
    if (this.dependencies.has(ref)) {
      this.dependencies.set(ref, null);
      this.limitation("Ambiguous repeated dependency enumeration.");
    } else {
      this.dependencies.set(ref, values === null ? null : new Set(values));
      // BOM-Link grammar is pinned by CycloneDX 1.5/1.6, not URL guessing.
      for (const value of values ?? [])
        if (
          /^urn:cdx:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[1-9][0-9]*#.+$/u.test(
            value,
          )
        ) {
          this.externalLinks.add(value);
          this.externalLinks.add(value.split("#")[0]!);
        }
    }
  }
  private relationship(node: ObjectValue, spdx3: boolean): void {
    const type = text(node.relationshipType)?.replaceAll("_", "").toLowerCase();
    let from = text(spdx3 ? node.from : node.spdxElementId),
      targets = strings(spdx3 ? node.to : node.relatedSpdxElement);
    if (
      spdx3 &&
      from &&
      ["hasdeclaredlicense", "hasconcludedlicense"].includes(type ?? "")
    ) {
      const previous = this.licenseRoles.get(from) ?? {
        declared: [],
        concluded: [],
      };
      this.licenseRoles.set(from, {
        declared: unique([
          ...previous.declared,
          ...(type === "hasdeclaredlicense" ? targets : []),
        ]),
        concluded: unique([
          ...previous.concluded,
          ...(type === "hasconcludedlicense" ? targets : []),
        ]),
      });
      return;
    }
    if (type === "describes" && from) {
      if (targets.length === 1) this.primary = targets[0]!;
      else this.limitation("Ambiguous primary component references.");
      return;
    }
    if (type === "dependencyof" && targets.length === 1 && from) {
      const target = targets[0]!;
      targets = [from];
      from = target;
    } else if (!["dependson", "contains"].includes(type ?? "")) return;
    if (!from) return;
    if (
      targets.some(
        (target) =>
          target === "NOASSERTION" || target.endsWith("/NoAssertionElement"),
      )
    ) {
      this.dependencies.set(from, null);
      return;
    }
    const actual = targets.filter(
      (target) => target !== "NONE" && !target.endsWith("/NoneElement"),
    );
    if (targets.length === 0) {
      this.dependencies.set(from, null);
      return;
    }
    if (this.dependencies.has(from) && this.dependencies.get(from) === null)
      return;
    const dependencies = this.dependencies.get(from) ?? new Set<string>();
    for (const target of actual) dependencies.add(target);
    this.dependencies.set(from, dependencies);
  }
  finish(): BsiProfileFacts {
    if (this.documentCreation) {
      const creation = this.creation.get(this.documentCreation);
      if (creation) {
        this.timestamp = creation.timestamp;
        this.creatorContacts = unique(
          creation.creatorRefs.flatMap((id) => this.agents.get(id) ?? []),
        );
      } else
        this.limitation(
          "SPDX document creator/timestamp references are unresolved.",
        );
    }
    if (!this.primary && this.documentRoots.length === 1) {
      const roots =
        this.sbomRoots.get(this.documentRoots[0]!) ?? this.documentRoots;
      if (roots.length === 1) this.primary = roots[0]!;
    }
    const components = this.pending.map((item) =>
      Object.freeze({
        ...item.facts,
        creatorContacts: unique([
          ...item.facts.creatorContacts,
          ...item.creatorRefs.flatMap((id) => this.agents.get(id) ?? []),
        ]),
        sha512: unique([
          ...item.facts.sha512,
          ...item.hashRefs.flatMap((id) => this.hashes.get(id) ?? []),
        ]),
        dependencies:
          this.dependencies.get(item.facts.reference) instanceof Set
            ? unique([...this.dependencies.get(item.facts.reference)!])
            : null,
        uncertainFields: unique([
          ...(item.facts.uncertainFields ?? []),
          ...(item.creatorRefs.some(
            (id) => !this.agents.has(id) || this.ambiguousReferences.has(id),
          )
            ? ["creatorContacts"]
            : []),
          ...(item.hashRefs.some(
            (id) => !this.hashes.has(id) || this.ambiguousReferences.has(id),
          )
            ? ["sha512"]
            : []),
          ...(this.dependencies.has(item.facts.reference) &&
          this.dependencies.get(item.facts.reference) === null
            ? ["dependencies"]
            : []),
        ]),
        declaredLicenses: unique([
          ...item.facts.declaredLicenses,
          ...(
            this.licenseRoles.get(item.facts.reference)?.declared ?? []
          ).flatMap((id) => this.licenseExpressions.get(id) ?? []),
        ]),
        concludedLicenses: unique([
          ...item.facts.concludedLicenses,
          ...(
            this.licenseRoles.get(item.facts.reference)?.concluded ?? []
          ).flatMap((id) => this.licenseExpressions.get(id) ?? []),
        ]),
      }),
    );
    for (const item of this.pending)
      if (
        item.creatorRefs.some((id) => !this.agents.has(id)) ||
        item.hashRefs.some((id) => !this.hashes.has(id))
      )
        this.limitation(
          "SPDX component creator/hash references are unresolved.",
        );
    return Object.freeze({
      format: this.options.format,
      specificationVersion: this.options.specificationVersion
        .replace(/^SPDX-/u, "")
        .replace(/^3\.0\.[01]$/u, "3.0"),
      serialization: this.options.serialization,
      documentVersion: this.documentVersion,
      creatorContacts: this.creatorContacts,
      timestamp: this.timestamp,
      documentUri: this.documentUri,
      primaryComponentReference: this.primary,
      embeddedVulnerabilityInformation: this.embedded,
      externalBomLinks: unique([...this.externalLinks]),
      externalDocumentReferences: unique([...this.externalDocumentReferences]),
      components: Object.freeze(components),
      limitations: Object.freeze([...this.issues]),
    });
  }
}
