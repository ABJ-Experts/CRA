import { describe, expect, it } from "vitest";
import type { Ecosystem } from "./model";
import { parsePurl } from "./purl";
import {
  joinUpstreamName,
  namespaceMatches,
  splitUpstreamName,
} from "./package-identity";

// Each row is: ecosystem, the upstream feed's name, the PURL that an SBOM would
// carry for the SAME package. The round-trip property below is the real
// assertion — if the two sides disagree, the package is unmatchable.
const IDENTITIES: Array<[Ecosystem, string, string, string | null, string]> = [
  [
    "maven",
    "org.apache.commons:commons-text",
    "pkg:maven/org.apache.commons/commons-text@1.9",
    "org.apache.commons",
    "commons-text",
  ],
  ["maven", "junit:junit", "pkg:maven/junit/junit@4.13", "junit", "junit"],
  ["semver", "@babel/core", "pkg:npm/%40babel/core@7.0.0", "@babel", "core"],
  ["semver", "lodash", "pkg:npm/lodash@4.17.21", null, "lodash"],
  [
    "go",
    "github.com/gin-gonic/gin",
    "pkg:golang/github.com/gin-gonic/gin@v1.9.0",
    "github.com/gin-gonic",
    "gin",
  ],
  ["pep440", "django", "pkg:pypi/django@4.2", null, "django"],
];

describe("splitUpstreamName", () => {
  it.each(IDENTITIES)(
    "%s: %s -> namespace %s, name %s",
    (ecosystem, upstream, _purl, expectedNs, expectedName) => {
      expect(splitUpstreamName(ecosystem, upstream)).toEqual({
        namespace: expectedNs,
        name: expectedName,
      });
    },
  );

  it("leaves flat-namespace ecosystems alone even when the name contains a separator", () => {
    // A Debian source package name never splits, whatever it looks like.
    expect(splitUpstreamName("deb", "linux-signed-amd64")).toEqual({
      namespace: null,
      name: "linux-signed-amd64",
    });
    expect(splitUpstreamName("rpm", "kernel-devel")).toEqual({
      namespace: null,
      name: "kernel-devel",
    });
  });

  it("does not treat an unscoped npm name containing a slash as scoped", () => {
    expect(splitUpstreamName("semver", "some/thing")).toEqual({
      namespace: null,
      name: "some/thing",
    });
  });
});

describe("feed coordinate and PURL agree on identity", () => {
  // The property that actually matters: whatever the feed calls a package and
  // whatever the SBOM's PURL calls it must reduce to the SAME (namespace, name).
  // Every historical matching bug in this area was a violation of exactly this.
  it.each(IDENTITIES)(
    "%s: feed name %s and PURL %s reduce to the same coordinate",
    (ecosystem, upstream, purl) => {
      const fromFeed = splitUpstreamName(ecosystem, upstream);
      const parsed = parsePurl(purl);
      expect(parsed).not.toBeNull();
      expect({ namespace: parsed!.namespace, name: parsed!.name }).toEqual(
        fromFeed,
      );
    },
  );

  it.each(IDENTITIES)(
    "%s: %s round-trips back through joinUpstreamName",
    (ecosystem, upstream) => {
      expect(
        joinUpstreamName(ecosystem, splitUpstreamName(ecosystem, upstream)),
      ).toBe(upstream);
    },
  );
});

describe("namespaceMatches", () => {
  it("treats a null advisory namespace as unscoped", () => {
    // Required: a Debian PURL carries a distro namespace the feed never has.
    expect(namespaceMatches(null, "debian")).toBe(true);
    expect(namespaceMatches(undefined, "debian")).toBe(true);
    expect(namespaceMatches(null, null)).toBe(true);
  });

  it("requires an exact match when the advisory IS scoped", () => {
    expect(namespaceMatches("org.apache.commons", "org.apache.commons")).toBe(
      true,
    );
    expect(namespaceMatches("org.apache.commons", "com.example")).toBe(false);
    expect(namespaceMatches("org.apache.commons", null)).toBe(false);
  });
});

describe("joinUpstreamName", () => {
  it("drops a PURL-only namespace for flat ecosystems", () => {
    // pkg:deb/debian/openssl must be asked upstream for as "openssl".
    expect(
      joinUpstreamName("deb", { namespace: "debian", name: "openssl" }),
    ).toBe("openssl");
  });
});
