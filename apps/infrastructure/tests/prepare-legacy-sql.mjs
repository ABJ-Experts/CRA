import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function prepareLegacySql(source, fixture) {
  const begin = /^[ \t]*begin[ \t]*;[ \t]*$/gim;
  const rollback = /(?:^|;)[ \t]*rollback\s*;/gim;
  const beginCount = [...source.matchAll(begin)].length;
  const rollbackCount = [...source.matchAll(rollback)].length;
  // Catalog-only legacy suites receive no fixture and run as supplied.
  if (beginCount === 0 && rollbackCount === 0) return source;
  if (
    beginCount === 0 ||
    beginCount !== rollbackCount ||
    /(?:^|;)[ \t]*commit\s*;/im.test(source)
  ) {
    throw new Error(
      "Legacy licensing fixtures require a BEGIN/ROLLBACK-only suite",
    );
  }
  return source.replace(begin, (statement) => `${statement}\n${fixture}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = readFileSync(process.argv[2], "utf8");
  const fixture = readFileSync(
    new URL("./m15-legacy-fixture.sql", import.meta.url),
    "utf8",
  );
  process.stdout.write(prepareLegacySql(source, fixture));
}
