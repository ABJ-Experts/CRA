/** Read-only parity check for completed M3 canonical PURL representation.
 * Requires the feature migration, local Docker PostgreSQL and installed API deps.
 * Run from repository root: node apps/infrastructure/tests/m14-05-identity-parity.mjs
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const require = createRequire(
  new URL("../../api/package.json", import.meta.url),
);
const { PackageURL } = require("packageurl-js");
const valid = [
  ["encoded version", "pkg:generic/acme/tool@1%2B2", "1+2"],
  ["Unicode version and namespace", "pkg:generic/ü/工具@vé", "vé"],
  ["npm namespace at sign", "pkg:npm/@scope/tool@1.2", "1.2"],
  [
    "qualifiers and subpath",
    "pkg:generic/acme/tool@1?arch=x86&distro=linux#lib/src",
    "1",
  ],
  ["encoded version at sign", "pkg:generic/a@1%402", "1@2"],
  ["encoded slash version", "pkg:generic/a@1%2F2", "1/2"],
  ["encoded percent", "pkg:generic/a@1%252F2", "1%2F2"],
  ["canonical qualifier order", "pkg:generic/a@1?z=last&a=first#dir", "1"],
  ["external normalized version", "pkg:generic/acme/a", "1.0"],
];
const cases = valid.map(([label, raw, version]) => {
  const parsed = PackageURL.fromString(raw);
  return {
    label,
    // This helper consumes canonical M3 representation, not arbitrary raw PURLs.
    purl: parsed.toString(),
    version,
    expected: {
      packageIdentity: new PackageURL(
        parsed.type,
        parsed.namespace,
        parsed.name,
        null,
        parsed.qualifiers,
        parsed.subpath,
      ).toString(),
      version,
    },
  };
});
cases.push(
  {
    label: "missing PURL",
    purl: null,
    version: "1",
    expected: { reason: "missingPurl" },
  },
  {
    label: "blank PURL",
    purl: " ",
    version: "1",
    expected: { reason: "missingPurl" },
  },
  {
    label: "missing version",
    purl: "pkg:generic/a",
    version: null,
    expected: { reason: "missingVersion" },
  },
  {
    label: "embedded/external conflict",
    purl: "pkg:generic/a@1",
    version: "2",
    expected: { reason: "versionConflict" },
  },
  {
    label: "invalid percent encoding",
    purl: "pkg:generic/a@1%ZZ",
    version: "1",
    expected: { reason: "invalidPurl" },
  },
  {
    label: "invalid UTF-8 encoding",
    purl: "pkg:generic/a@%FF",
    version: "1",
    expected: { reason: "invalidPurl" },
  },
  {
    label: "empty embedded version",
    purl: "pkg:generic/a@",
    version: "1",
    expected: { reason: "invalidPurl" },
  },
  {
    label: "name-only identifier",
    purl: "tool",
    version: "1",
    expected: { reason: "invalidPurl" },
  },
);
// Hex literals avoid shell interpolation and quote-dependent SQL escaping.
const literal = (value) =>
  value === null
    ? "null"
    : `convert_from(decode('${Buffer.from(value, "utf8").toString("hex")}','hex'),'UTF8')`;
const sql =
  "begin read only;\n" +
  cases
    .map(
      (c, i) =>
        `select jsonb_build_object('index',${i},'actual',public.m14_05_package_identity(${literal(c.purl)},${literal(c.version)}))::text;`,
    )
    .join("\n") +
  "\nrollback;\n";
const result = spawnSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_cra",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 },
);
if (result.status !== 0)
  throw new Error(
    `Read-only identity parity query failed: ${result.stderr || result.error?.message || "unknown database failure"}`,
  );
const rows = result.stdout
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert.equal(
  rows.length,
  cases.length,
  "Each identity case must have one result",
);
for (const row of rows)
  assert.deepEqual(
    row.actual,
    cases[row.index].expected,
    cases[row.index].label,
  );
console.log(
  `PASS: ${cases.length} canonical PURL identity/version parity cases; read-only database transaction.`,
);
