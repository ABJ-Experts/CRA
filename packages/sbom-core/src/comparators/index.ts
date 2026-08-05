// Version comparators — one Strategy per ecosystem, selected by an Abstract
// Factory. BRD §10.3 rule: "If a comparator has no test file, the ecosystem is
// not supported." Each import here has a sibling *.spec.ts.
import type { Ecosystem } from "../model";
import { compare as semver } from "./semver";
import { compare as deb } from "./deb";
import { compare as rpm } from "./rpm";
import { compare as maven } from "./maven";
import { compare as pep440 } from "./pep440";
import { compare as go } from "./go";

export type VersionComparator = (a: string, b: string) => -1 | 0 | 1;

const COMPARATORS: Record<Ecosystem, VersionComparator> = {
  semver,
  deb,
  rpm,
  maven,
  pep440,
  go,
};

export function comparatorFor(ecosystem: Ecosystem): VersionComparator {
  return COMPARATORS[ecosystem];
}

export { semver, deb, rpm, maven, pep440, go };
