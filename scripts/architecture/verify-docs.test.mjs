import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PATTERNS, verifyArchitectureDocs } from "./verify-docs.mjs";

async function temporaryRoot(t) {
  const root = await mkdtemp(join(tmpdir(), "cra-architecture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writePolicyShell(root, { matrix, template }) {
  await mkdir(join(root, "docs", "architecture", "adrs"), {
    recursive: true,
  });
  await writeFile(
    join(root, "docs", "architecture", "pattern-selection-matrix.md"),
    matrix,
  );
  await writeFile(
    join(root, "docs", "architecture", "feature-design-template.md"),
    template,
  );
  await writeFile(
    join(root, "docs", "architecture", "README.md"),
    [
      "Patterns solve demonstrated problems; they are not a quota.",
      "presentation to application to domain",
      "Infrastructure adapters depend inward on ports",
      "cra_rt stays HttpOnly",
      "Authorization uncertainty fails closed",
    ].join("\n"),
  );
  await writeFile(
    join(root, "docs", "architecture", "adrs", "ADR-0001-pattern-selection.md"),
    [
      "# ADR-0001",
      "Status: Accepted",
      "## Decision",
      "Patterns solve demonstrated problems; they are not a quota.",
      "## Consequences",
      "## Rollback",
    ].join("\n"),
  );
}

async function copyRepositoryPolicy(root) {
  const paths = [
    "AGENTS.md",
    "docs/ai/coding-rules.md",
    "docs/architecture/README.md",
    "docs/architecture/pattern-selection-matrix.md",
    "docs/architecture/feature-design-template.md",
    "docs/architecture/adrs/ADR-0001-pattern-selection.md",
  ];
  for (const path of paths) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(process.cwd(), path), "utf8"));
  }
}

test("requires all 22 pattern names and feature decision questions", async (t) => {
  const root = await temporaryRoot(t);
  await mkdir(join(root, "docs", "architecture"), { recursive: true });
  await writeFile(
    join(root, "docs", "architecture", "pattern-selection-matrix.md"),
    "# Matrix\nFactory Method\n",
  );
  await writeFile(
    join(root, "docs", "architecture", "feature-design-template.md"),
    "# Template\n",
  );

  const errors = await verifyArchitectureDocs(root);

  assert.ok(errors.some((error) => error.includes("Visitor")));
  assert.ok(errors.some((error) => error.includes("Why not simpler?")));
});

test("accepts the repository architecture policy", async () => {
  const errors = await verifyArchitectureDocs(process.cwd());

  assert.deepEqual(
    errors.filter((error) => !error.startsWith("AGENTS.md")),
    [],
  );
});

test("requires enforceable architecture rules in the root agent guide", async () => {
  const errors = await verifyArchitectureDocs(process.cwd());

  assert.deepEqual(
    errors.filter((error) => error.startsWith("AGENTS.md")),
    [],
  );
});

test("rejects an agent guide that makes the feature template a quota", async (t) => {
  const root = await temporaryRoot(t);
  await copyRepositoryPolicy(root);
  const agentPath = join(root, "AGENTS.md");
  const agentGuide = await readFile(agentPath, "utf8");
  await writeFile(
    agentPath,
    agentGuide.replace(
      /Before a feature\s+introduces a new abstraction, provider, state machine, cross-feature dependency,\s+or persistent workflow, complete/,
      "For every feature, complete",
    ),
  );

  const errors = await verifyArchitectureDocs(root);

  assert.ok(
    errors.some((error) =>
      error.includes("Before a feature introduces a new abstraction"),
    ),
  );
});

test("reports every missing required document instead of throwing", async (t) => {
  const root = await temporaryRoot(t);

  const errors = await verifyArchitectureDocs(root);

  for (const path of [
    "AGENTS.md",
    "docs/ai/coding-rules.md",
    "docs/architecture/README.md",
    "docs/architecture/pattern-selection-matrix.md",
    "docs/architecture/feature-design-template.md",
    "docs/architecture/adrs/ADR-0001-pattern-selection.md",
  ]) {
    assert.ok(errors.includes(`Missing architecture document: ${path}`));
  }
});

test("requires real pattern blocks and template headings", async (t) => {
  const root = await temporaryRoot(t);
  await writePolicyShell(root, {
    matrix: PATTERNS.join("\n"),
    template:
      "Concrete problem Why not simpler? Selected patterns Rejected patterns Tests and observability Failure modes Rollback",
  });

  const errors = await verifyArchitectureDocs(root);

  assert.ok(
    errors.some((error) =>
      error.includes("Pattern matrix is missing section heading ### Visitor"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("Feature template is missing heading ## Rollback"),
    ),
  );
});

test("requires the detailed coding workflow and completion gates", async (t) => {
  const root = await temporaryRoot(t);
  await mkdir(join(root, "docs", "ai"), { recursive: true });
  await writeFile(
    join(root, "docs", "ai", "coding-rules.md"),
    "# Coding rules\n## Required sequence\n",
  );

  const errors = await verifyArchitectureDocs(root);

  assert.ok(
    errors.some((error) =>
      error.includes("Coding rules are missing heading ## Completion gate"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("Never automatically retry a POST/PATCH"),
    ),
  );
});

test("CLI exits nonzero when architecture documents are missing", async (t) => {
  const root = await temporaryRoot(t);
  const verifier = fileURLToPath(new URL("./verify-docs.mjs", import.meta.url));

  const result = spawnSync(process.execPath, [verifier], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing architecture document/);
});
