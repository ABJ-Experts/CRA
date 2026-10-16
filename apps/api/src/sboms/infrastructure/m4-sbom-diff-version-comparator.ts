import {
  compareVersion,
  type VersionComparatorId,
} from "../../vulnerabilities/matching/comparators/version-comparator";
import type { SbomDiffVersionComparator } from "../worker/sbom-diff-worker";
/** New reports record this adapter policy; historical reports keep their policy. */
export const SBOM_DIFF_COMPARATOR_VERSION = "m3-m4-version-comparators.v1";
const byEcosystem: Readonly<Record<string, VersionComparatorId>> =
  Object.freeze({
    npm: "semver",
    maven: "maven",
    pypi: "pep440",
    deb: "debian",
    debian: "debian",
    rpm: "rpm",
    golang: "go",
    go: "go",
  });
/** Provider adapter reuses M4's ordering; unsupported ecosystems never fall back to lexical sorting. */
export function createM4SbomDiffVersionComparator(): SbomDiffVersionComparator {
  return Object.freeze({
    version: SBOM_DIFF_COMPARATOR_VERSION,
    compare(ecosystem: string, left: string, right: string) {
      const comparator = byEcosystem[ecosystem];
      // M4 uses Number for these comparator tokens (and Debian/RPM epochs).
      // Refuse lossy integers at this adapter boundary instead of claiming equality.
      const numericTokens = (value: string) =>
        comparator === "debian" || comparator === "rpm"
          ? (value.match(/^([0-9]+):/)?.slice(1) ?? [])
          : (value.match(/[0-9]+/g) ?? []);
      if (
        [...numericTokens(left), ...numericTokens(right)].some(
          (token) => !Number.isSafeInteger(Number(token)),
        )
      ) {
        return { kind: "unsupported" as const };
      }
      return comparator
        ? compareVersion(comparator, left, right)
        : { kind: "unsupported" as const };
    },
  });
}
