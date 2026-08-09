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

const REQUIRED_AGENT_RULES = Object.freeze([
  "Patterns solve demonstrated problems; they are not a quota",
  "Before a feature introduces a new abstraction, provider, state machine, cross-feature dependency, or persistent workflow, complete docs/architecture/feature-design-template.md",
  "presentation -> application -> domain",
  "No direct Supabase access from controllers",
  "orgId as its first argument",
  "80% coverage",
  "docs/architecture/feature-design-template.md",
]);

const CODING_RULE_HEADINGS = Object.freeze([
  "Required sequence",
  "Pattern acceptance checks",
  "Security and consistency review",
  "Completion gate",
]);

const REQUIRED_CODING_RULES = Object.freeze([
  "Write the new failing test before production implementation",
  "Never automatically retry a POST/PATCH",
  "at least 80% branch, function, line, and statement coverage",
  "an independent review has no unresolved critical or high findings",
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
  const agentGuide = await readRequired(rootDir, "AGENTS.md", errors);
  const codingRules = await readRequired(
    rootDir,
    "docs/ai/coding-rules.md",
    errors,
  );
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
    const decisionCount = matrixLines.filter((line) => line === heading).length;
    if (decisionCount !== 1) {
      errors.push(
        `Pattern matrix must contain exactly one ${heading} decision`,
      );
    }
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

  const normalizedAgentGuide = normalize(agentGuide);
  for (const rule of REQUIRED_AGENT_RULES) {
    if (!normalizedAgentGuide.includes(rule)) {
      errors.push(`AGENTS.md is missing architecture rule: ${rule}`);
    }
  }

  const codingHeadings = new Set(codingRules.split(/\r?\n/));
  for (const heading of CODING_RULE_HEADINGS) {
    if (!codingHeadings.has(`## ${heading}`)) {
      errors.push(`Coding rules are missing heading ## ${heading}`);
    }
  }
  const normalizedCodingRules = normalize(codingRules);
  for (const rule of REQUIRED_CODING_RULES) {
    if (!normalizedCodingRules.includes(rule)) {
      errors.push(`Coding rules are missing requirement: ${rule}`);
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
