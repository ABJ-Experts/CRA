// Canonical package identity: the ONE place that knows how each ecosystem's
// native package coordinate maps onto PURL's (namespace, name) split.
//
// Why this file exists. The same package was being spelled three different ways
// along the matching path, and the disagreements cancelled out often enough to
// look like it worked:
//
//   1. the SBOM's own `name` field, which varies by build tool — cyclonedx-maven
//      writes "commons-text" and puts the groupId in `group`, while cyclonedx-npm
//      writes the whole "@babel/core" into `name`;
//   2. the upstream feed's coordinate, where OSV addresses Maven as
//      "groupId:artifactId" and npm as "@scope/pkg";
//   3. the PURL, where those are always (namespace, name).
//
// PURL is the arbiter — BRD §2.3 calls it "the matching key we want wherever it
// exists" — so everything is converted into PURL shape and compared there. Any
// new ecosystem adds a case here and a case in the spec, and nowhere else.

import type { Ecosystem } from "./model";

export interface PackageCoordinate {
  namespace: string | null;
  name: string;
}

/**
 * Convert an upstream feed coordinate (the `name` OSV and GHSA report) into PURL
 * shape.
 *
 * The split rules follow the PURL type definitions rather than each registry's
 * display convention, because the other side of the comparison is always a
 * parsed PURL.
 */
export function splitUpstreamName(
  ecosystem: Ecosystem,
  upstream: string,
): PackageCoordinate {
  switch (ecosystem) {
    case "maven": {
      // "org.apache.commons:commons-text"
      const i = upstream.indexOf(":");
      if (i <= 0) return { namespace: null, name: upstream };
      return { namespace: upstream.slice(0, i), name: upstream.slice(i + 1) };
    }
    case "semver": {
      // npm scopes only. A bare "lodash" or a crates.io name has no namespace,
      // and the leading @ is what distinguishes a scope from a path.
      if (!upstream.startsWith("@")) return { namespace: null, name: upstream };
      const i = upstream.indexOf("/");
      if (i <= 0) return { namespace: null, name: upstream };
      return { namespace: upstream.slice(0, i), name: upstream.slice(i + 1) };
    }
    case "go": {
      // "github.com/gin-gonic/gin" -> namespace "github.com/gin-gonic".
      // PURL puts every leading segment of the module path in the namespace.
      const i = upstream.lastIndexOf("/");
      if (i <= 0) return { namespace: null, name: upstream };
      return { namespace: upstream.slice(0, i), name: upstream.slice(i + 1) };
    }
    case "pep440":
    case "deb":
    case "rpm":
      // These registries have a flat namespace. Note that a deb PURL still
      // carries a distro namespace ("pkg:deb/debian/openssl") that the feed
      // never supplies — see namespaceMatches for how that asymmetry is handled.
      return { namespace: null, name: upstream };
  }
}

/** Inverse of splitUpstreamName: rebuild the coordinate a feed expects to be asked for. */
export function joinUpstreamName(
  ecosystem: Ecosystem,
  coordinate: PackageCoordinate,
): string {
  const { namespace, name } = coordinate;
  if (!namespace) return name;
  switch (ecosystem) {
    case "maven":
      return `${namespace}:${name}`;
    case "semver":
    case "go":
      return `${namespace}/${name}`;
    case "pep440":
    case "deb":
    case "rpm":
      // A namespace here came from the PURL (e.g. the "debian" in
      // pkg:deb/debian/openssl) and is not part of the upstream name.
      return name;
  }
}

/**
 * Does an advisory's package namespace admit a component's namespace?
 *
 * An advisory namespace of null means "unscoped" and matches anything. That is
 * not laxness — it is required, because a Debian PURL carries a distro namespace
 * ("pkg:deb/debian/openssl") that no feed ever populates, so demanding equality
 * would silently drop every OS-package finding.
 *
 * When the advisory DOES carry a namespace it must match exactly. That is the
 * rule that stops two Maven artifacts sharing an artifactId under different
 * groupIds from being treated as the same package.
 */
export function namespaceMatches(
  advisoryNamespace: string | null | undefined,
  componentNamespace: string | null,
): boolean {
  if (advisoryNamespace === null || advisoryNamespace === undefined)
    return true;
  return advisoryNamespace === componentNamespace;
}
