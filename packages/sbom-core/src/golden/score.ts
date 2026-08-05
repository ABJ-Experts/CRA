// Accuracy scoring for the golden dataset (FR-MATCH-005, BRD §23: "False
// positive and false negative rates are release metrics").
//
// FR-MATCH-004 requires those rates to be reportable by method and by ecosystem,
// so the report breaks down both ways rather than emitting a single number.

import {
  matchComponent,
  type AdvisoryLookup,
  type MatchCandidate,
} from "../matching";
import type { NormalizedComponent } from "../model";
import type { GoldenCase } from "./corpus";

export interface Breakdown {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
}

export interface CaseResult {
  id: string;
  why: string;
  ecosystem: string;
  /** The §10.2 layer this component should be evaluated by. Attribution only. */
  layer: string;
  expected: string[];
  actual: MatchCandidate[];
  truePositives: string[];
  /** Advisories reported that should not have been — the false positives. */
  falsePositives: MatchCandidate[];
  /** Advisories that should have been reported and were not. */
  falseNegatives: string[];
}

export interface AccuracyReport {
  corpusSize: number;
  /** Total expected findings across the corpus (the recall denominator). */
  expectedFindings: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  byMethod: Record<string, Breakdown>;
  byEcosystem: Record<string, Breakdown>;
  /** Every case with at least one FP or FN, for a readable failure summary. */
  failures: CaseResult[];
}

/**
 * Which §10.2 layer the engine will use for this component. Mirrors the branch
 * order in matchComponent(), and exists ONLY so a false negative can be
 * attributed to a method for the FR-MATCH-004 breakdown — it never affects
 * pass/fail.
 */
export function expectedLayer(component: NormalizedComponent): string {
  if (component.purl && component.ecosystem && component.version) {
    return "purl_range";
  }
  if (component.cpe && component.version) return "cpe_match";
  return "none";
}

/**
 * Precision with an explicit empty case: claiming nothing is perfect precision,
 * not a divide by zero. Same shape for recall — nothing to find means nothing
 * was missed. Getting this wrong turns an empty corpus into a green build.
 */
function ratio(hit: number, total: number): number {
  if (total === 0) return 1;
  return Math.round((hit / total) * 10_000) / 10_000;
}

function emptyBreakdown(): Breakdown {
  return { tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 };
}

function bump(
  table: Record<string, Breakdown>,
  key: string,
  field: "tp" | "fp" | "fn",
  by: number,
): void {
  if (by === 0) return;
  table[key] ??= emptyBreakdown();
  table[key][field] += by;
}

function finalise(table: Record<string, Breakdown>): void {
  for (const b of Object.values(table)) {
    b.precision = ratio(b.tp, b.tp + b.fp);
    b.recall = ratio(b.tp, b.tp + b.fn);
  }
}

export function scoreCase(
  testCase: GoldenCase,
  lookup: AdvisoryLookup,
): CaseResult {
  const actual = matchComponent(testCase.component, lookup);
  const actualIds = new Set(actual.map((c) => c.advisoryId));
  const expected = new Set(testCase.expected);

  return {
    id: testCase.id,
    why: testCase.why,
    ecosystem: testCase.component.ecosystem ?? "none",
    layer: expectedLayer(testCase.component),
    expected: testCase.expected,
    actual,
    truePositives: testCase.expected.filter((id) => actualIds.has(id)),
    falsePositives: actual.filter((c) => !expected.has(c.advisoryId)),
    falseNegatives: testCase.expected.filter((id) => !actualIds.has(id)),
  };
}

export function scoreCorpus(
  cases: GoldenCase[],
  lookup: AdvisoryLookup,
): AccuracyReport {
  const results = cases.map((c) => scoreCase(c, lookup));

  const byMethod: Record<string, Breakdown> = {};
  const byEcosystem: Record<string, Breakdown> = {};
  let tp = 0;
  let fp = 0;
  let fn = 0;

  for (const r of results) {
    tp += r.truePositives.length;
    fp += r.falsePositives.length;
    fn += r.falseNegatives.length;

    bump(byEcosystem, r.ecosystem, "tp", r.truePositives.length);
    bump(byEcosystem, r.ecosystem, "fp", r.falsePositives.length);
    bump(byEcosystem, r.ecosystem, "fn", r.falseNegatives.length);

    // True positives are attributed by the method the engine actually used; a
    // false positive by the method that wrongly produced it. False negatives
    // have no actual candidate, so they fall to the layer that should have run.
    for (const c of r.actual) {
      const isFp = r.falsePositives.includes(c);
      bump(byMethod, c.method, isFp ? "fp" : "tp", 1);
    }
    bump(byMethod, r.layer, "fn", r.falseNegatives.length);
  }

  finalise(byMethod);
  finalise(byEcosystem);

  return {
    corpusSize: cases.length,
    expectedFindings: cases.reduce((n, c) => n + c.expected.length, 0),
    tp,
    fp,
    fn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    byMethod,
    byEcosystem,
    failures: results.filter(
      (r) => r.falsePositives.length > 0 || r.falseNegatives.length > 0,
    ),
  };
}

/**
 * Human-readable failure summary. A bare `expected 0.94 to be >= 0.95` tells an
 * engineer nothing about which rule broke, which is the whole point of the
 * `why` field on every case.
 */
export function formatFailures(report: AccuracyReport): string {
  if (report.failures.length === 0) return "";
  const lines = [
    `${report.failures.length} of ${report.corpusSize} golden cases regressed:`,
    "",
  ];
  for (const f of report.failures) {
    lines.push(`  ${f.id}  [${f.ecosystem}/${f.layer}]`);
    lines.push(`    rule: ${f.why}`);
    if (f.falsePositives.length > 0) {
      lines.push(
        `    FALSE POSITIVE: ${f.falsePositives
          .map((c) => `${c.advisoryId} (${c.method} @${c.confidence})`)
          .join(", ")}`,
      );
    }
    if (f.falseNegatives.length > 0) {
      lines.push(`    FALSE NEGATIVE: ${f.falseNegatives.join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
