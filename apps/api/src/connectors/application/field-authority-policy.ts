import type { ExternalRecord } from "./connector-port";

/**
 * Pure per-field system-of-record decision. No I/O, no persistence, no
 * knowledge of `sync_run_plan_items` or `sync_conflicts` rows -- the caller
 * (worker) turns a `FieldAction` into the appropriate plan-item action or
 * conflict row. Style mirrors `product-relationship-graph-policy.ts`.
 */

export type FieldAuthorityPolicyValue =
  | "external_authoritative"
  | "cra_authoritative"
  | "newest_with_review"
  | "manual_only";

export type FieldAuthorityPolicy = Readonly<{
  id: string;
  policyVersion: number;
  policyValue: FieldAuthorityPolicyValue;
  protected: boolean;
}>;

export type FieldAction = "apply_external" | "keep_cra" | "raise_conflict";

/**
 * `manual_only` is the fail-closed default: an entity/field pair with no
 * explicit policy row never lets an external value overwrite CRA data
 * silently. `protected` is guarded defensively for `newest_with_review` even
 * though the database also rejects `protected + external_authoritative` at
 * the row level -- a protected field must never auto-apply either way.
 */
export function decideFieldAction(
  input: Readonly<{
    policy: FieldAuthorityPolicy | null;
    craValue: unknown;
    craObservedAt: string;
    externalValue: unknown;
    externalObservedAt: string;
  }>,
): FieldAction {
  const policyValue: FieldAuthorityPolicyValue =
    input.policy?.policyValue ?? "manual_only";
  const changed = !valuesEqual(input.craValue, input.externalValue);
  const isProtected = input.policy?.protected ?? false;

  if (!changed) return "keep_cra";

  switch (policyValue) {
    case "external_authoritative":
      return isProtected ? "keep_cra" : "apply_external";
    case "cra_authoritative":
      return "keep_cra";
    case "manual_only":
      return "raise_conflict";
    case "newest_with_review": {
      const externalIsNewer =
        Date.parse(input.externalObservedAt) > Date.parse(input.craObservedAt);
      return externalIsNewer && !isProtected
        ? "apply_external"
        : "raise_conflict";
    }
  }
}

/**
 * `field` names which key of `externalRecord.fields` (and, by the caller's
 * convention, of the CRA entity) this sample row is previewing -- the
 * proposed policy is always scoped to a single field, but nothing else in
 * this tuple carries that name.
 */
export type FieldAuthorityImpactSample = Readonly<{
  externalRecord: ExternalRecord;
  field: string;
  craFieldValue: unknown;
  craObservedAt: string;
}>;

export type FieldAuthorityImpactTally = Readonly<{
  wouldCreate: number;
  wouldUpdate: number;
  wouldBeIgnored: number;
  wouldConflict: number;
}>;

/**
 * Tallies what `decideFieldAction` would do for a proposed (not-yet-saved)
 * policy over a caller-supplied sample, so the UI can preview an authority
 * change before committing it. `craFieldValue === undefined` marks a record
 * with no matching CRA entity yet, i.e. a would-be create.
 */
export function previewFieldAuthorityImpact(
  input: Readonly<{
    proposedPolicy: FieldAuthorityPolicy;
    sample: readonly FieldAuthorityImpactSample[];
  }>,
): FieldAuthorityImpactTally {
  return input.sample.reduce<FieldAuthorityImpactTally>(
    (tally, item) => {
      if (item.craFieldValue === undefined) {
        return { ...tally, wouldCreate: tally.wouldCreate + 1 };
      }
      const action = decideFieldAction({
        policy: input.proposedPolicy,
        craValue: item.craFieldValue,
        craObservedAt: item.craObservedAt,
        externalValue: item.externalRecord.fields[item.field] ?? null,
        externalObservedAt: item.externalRecord.externalUpdatedAt,
      });
      switch (action) {
        case "apply_external":
          return { ...tally, wouldUpdate: tally.wouldUpdate + 1 };
        case "keep_cra":
          return { ...tally, wouldBeIgnored: tally.wouldBeIgnored + 1 };
        case "raise_conflict":
          return { ...tally, wouldConflict: tally.wouldConflict + 1 };
      }
    },
    { wouldCreate: 0, wouldUpdate: 0, wouldBeIgnored: 0, wouldConflict: 0 },
  );
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return false;
  if (typeof left !== typeof right) return false;
  if (typeof left === "object") {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}
