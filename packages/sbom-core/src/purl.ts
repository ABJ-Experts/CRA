import type { Ecosystem } from "./model";

export interface ParsedPurl {
  type: string;
  namespace: string | null;
  name: string;
  version: string | null;
}

// Minimal Package URL parser: pkg:type/namespace/name@version?qualifiers#subpath
export function parsePurl(purl: string): ParsedPurl | null {
  if (!purl.startsWith("pkg:")) return null;
  let rest = purl.slice(4);
  const hash = rest.indexOf("#");
  if (hash >= 0) rest = rest.slice(0, hash);
  const q = rest.indexOf("?");
  if (q >= 0) rest = rest.slice(0, q);

  let version: string | null = null;
  const at = rest.lastIndexOf("@");
  if (at >= 0) {
    version = decodeURIComponent(rest.slice(at + 1));
    rest = rest.slice(0, at);
  }
  const slash = rest.indexOf("/");
  if (slash < 0) return null;
  const type = rest.slice(0, slash).toLowerCase();
  const path = rest
    .slice(slash + 1)
    .split("/")
    .filter(Boolean);
  if (path.length === 0) return null;
  const name = decodeURIComponent(path[path.length - 1]!);
  const namespace =
    path.length > 1
      ? path.slice(0, -1).map(decodeURIComponent).join("/")
      : null;
  return { type, namespace, name, version };
}

// PURL type -> comparator ecosystem (BRD §10: ecosystem selects the comparator).
const ECOSYSTEM_BY_PURL_TYPE: Record<string, Ecosystem> = {
  npm: "semver",
  cargo: "semver",
  gem: "semver",
  nuget: "semver",
  composer: "semver",
  pypi: "pep440",
  maven: "maven",
  deb: "deb",
  rpm: "rpm",
  golang: "go",
  go: "go",
};

export function ecosystemForPurlType(type: string): Ecosystem | null {
  return ECOSYSTEM_BY_PURL_TYPE[type.toLowerCase()] ?? null;
}

// Canonical version for indexing (computed once at ingest). Ecosystem-correct
// COMPARISON happens in the comparators; this is only a stable stored form.
export function normaliseVersion(version: string | null): string | null {
  if (!version) return null;
  return version.trim().replace(/^v(?=\d)/, "");
}
