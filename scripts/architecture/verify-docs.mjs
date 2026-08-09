import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PATTERNS = Object.freeze([
  "Factory Method",
  "Abstract Factory",
  "Builder",
  "Prototype",
  "Singleton",
  "Adapter",
  "Bridge",
  "Composite",
  "Decorator",
  "Facade",
  "Flyweight",
  "Proxy",
  "Chain of Responsibility",
  "Command",
  "Iterator",
  "Mediator",
  "Memento",
  "Observer",
  "State",
  "Strategy",
  "Template Method",
  "Visitor",
]);

const TEMPLATE_HEADINGS = Object.freeze([
  "Concrete problem",
  "Why not simpler?",
  "Selected patterns",
  "Rejected patterns",
  "Tests and observability",
  "Failure modes",
  "Rollback",
]);

const PATTERN_FIELDS = Object.freeze([
  "Decision",
  "CRA anchor",
  "Trigger",
  "Avoid",
  "Failure modes and tests",
  "Related patterns",
]);

const README_RULES = Object.freeze([
  "Patterns solve demonstrated problems; they are not a quota.",
  "presentation to application to domain",
  "Infrastructure adapters depend inward on ports",
  "cra_rt stays HttpOnly",
  "Authorization uncertainty fails closed",
]);

const ADR_RULES = Object.freeze([
  "Status: Accepted",
  "Patterns solve demonstrated problems; they are not a quota.",
]);

function normalize(source) {
  return source.replaceAll("`", "").replace(/\s+/g, " ").trim();
}

function section(lines, heading) {
  const start = lines.indexOf(heading);
  if (start === -1) return null;
  const next = lines.findIndex(
    (line, index) => index > start && line.startsWith("### "),
  );
  return lines.slice(start + 1, next === -1 ? undefined : next).join("\n");
}

async function readRequired(rootDir, relativePath, errors) {
  try {
    return await readFile(join(rootDir, relativePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      errors.push(`Missing architecture document: ${relativePath}`);
      return "";
    }
    throw error;
  }
}

export async function verifyArchitectureDocs(rootDir) {
  const errors = [];
  const readme = await readRequired(
    rootDir,
    "docs/architecture/README.md",
    errors,
  );
  const matrix = await readRequired(
    rootDir,
    "docs/architecture/pattern-selection-matrix.md",
    errors,
  );
  const template = await readRequired(
    rootDir,
    "docs/architecture/feature-design-template.md",
    errors,
  );
  const adr = await readRequired(
    rootDir,
    "docs/architecture/adrs/ADR-0001-pattern-selection.md",
    errors,
  );

  const matrixLines = matrix.split(/\r?\n/);
  for (const pattern of PATTERNS) {
    const heading = `### ${pattern}`;
    const block = section(matrixLines, heading);
    if (block === null) {
      errors.push(`Pattern matrix is missing section heading ${heading}`);
      continue;
    }
    for (const field of PATTERN_FIELDS) {
      if (!block.includes(`- ${field}:`)) {
        errors.push(`${heading} is missing field ${field}`);
      }
    }
  }

  const templateHeadings = new Set(template.split(/\r?\n/));
  for (const heading of TEMPLATE_HEADINGS) {
    if (!templateHeadings.has(`## ${heading}`)) {
      errors.push(`Feature template is missing heading ## ${heading}`);
    }
  }

  const normalizedReadme = normalize(readme);
  for (const rule of README_RULES) {
    if (!normalizedReadme.includes(rule)) {
      errors.push(`Architecture README is missing policy: ${rule}`);
    }
  }

  const normalizedAdr = normalize(adr);
  for (const rule of ADR_RULES) {
    if (!normalizedAdr.includes(rule)) {
      errors.push(`ADR-0001 is missing policy: ${rule}`);
    }
  }
  const adrHeadings = new Set(adr.split(/\r?\n/));
  for (const heading of ["Decision", "Consequences", "Rollback"]) {
    if (!adrHeadings.has(`## ${heading}`)) {
      errors.push(`ADR-0001 is missing heading ## ${heading}`);
    }
  }

  return Object.freeze(errors);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = await verifyArchitectureDocs(process.cwd());
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}
