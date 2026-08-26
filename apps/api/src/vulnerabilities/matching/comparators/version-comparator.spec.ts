import { compareVersion, type VersionComparatorId } from "./version-comparator";

type Example = Readonly<{
  comparator: VersionComparatorId;
  lower: string;
  higher: string;
}>;

const examples: readonly Example[] = [
  { comparator: "semver", lower: "1.9.0", higher: "1.10.0" },
  { comparator: "debian", lower: "1.0~rc1-1", higher: "1.0-1" },
  { comparator: "debian", lower: "1:1.0-1", higher: "2:0.1-1" },
  { comparator: "rpm", lower: "1.0~rc1-1", higher: "1.0-1" },
  { comparator: "rpm", lower: "1.9-1", higher: "1.10-1" },
  { comparator: "maven", lower: "1.0-rc1", higher: "1.0" },
  { comparator: "pep440", lower: "1.0rc1", higher: "1.0" },
  { comparator: "pep440", lower: "1.0", higher: "1.0.post1" },
  { comparator: "go", lower: "v1.9.0", higher: "v1.10.0+incompatible" },
  { comparator: "pep440", lower: "1.0.dev1", higher: "1.0rc1" },
  { comparator: "pep440", lower: "1.0", higher: "1.0+local.1" },
  { comparator: "maven", lower: "1.0", higher: "1.0-sp" },
];

describe("version comparator registry", () => {
  it.each(examples)(
    "compares $comparator versions without lexical ordering",
    ({ comparator, lower, higher }) => {
      expect(compareVersion(comparator, lower, higher)).toEqual({
        kind: "comparable",
        ordering: -1,
      });
    },
  );

  it("implements Maven numeric equivalence", () => {
    expect(compareVersion("maven", "1.0", "1.0.0")).toEqual({
      kind: "comparable",
      ordering: 0,
    });
  });

  it("handles SemVer prerelease and build metadata", () => {
    expect(compareVersion("semver", "1.0.0-alpha.1", "1.0.0")).toEqual({
      kind: "comparable",
      ordering: -1,
    });
    expect(compareVersion("semver", "1.0.0+build.1", "1.0.0+build.2")).toEqual({
      kind: "comparable",
      ordering: 0,
    });
  });

  it("retains Debian revision and Go compatibility equivalence", () => {
    expect(compareVersion("debian", "1:1.0-1", "1:1.0-2")).toEqual({
      kind: "comparable",
      ordering: -1,
    });
    expect(compareVersion("go", "v1.2.3+incompatible", "v1.2.3")).toEqual({
      kind: "comparable",
      ordering: 0,
    });
  });

  it("applies RPM numeric segments ahead of alphabetic segments", () => {
    expect(compareVersion("rpm", "1.0a-1", "1.0.1-1")).toEqual({
      kind: "comparable",
      ordering: -1,
    });
  });

  it("returns a reviewable unsupported result for malformed versions", () => {
    expect(compareVersion("semver", "not a version", "1.0.0")).toEqual({
      kind: "unsupported",
      reason: "invalid_version",
    });
  });
});
