// Obligation escalation tick (BRD §11.4, FR-SLA-005/006). Pure and deterministic
// (ADR-010, no AI): given a stage's window [anchoredAt, dueAt] and the current
// instant, decide which escalation thresholds are newly crossed and whether the
// stage is overdue. All instants are UTC.

// §11.4 escalation points, as a fraction of the window consumed. A documented
// table, never magic numbers scattered through the tick.
export const ESCALATION_THRESHOLDS = [0.5, 0.75, 0.9, 1.0] as const;

export interface StageEvaluation {
  /** Fraction of the window consumed at `now` (can exceed 1 once overdue). */
  fractionElapsed: number;
  /** now >= dueAt — the deadline has passed. */
  overdue: boolean;
  /** Thresholds reached now that were not in `alreadyNotified` (ascending). */
  newlyCrossed: number[];
}

/**
 * Evaluate one stage. `alreadyNotified` makes this idempotent: re-running with the
 * same inputs yields no new crossings, so obligation.tick never double-sends.
 */
export function evaluateStage(
  anchoredAt: Date,
  dueAt: Date,
  now: Date,
  alreadyNotified: readonly number[],
): StageEvaluation {
  const windowMs = dueAt.getTime() - anchoredAt.getTime();
  const elapsedMs = now.getTime() - anchoredAt.getTime();
  const overdue = now.getTime() >= dueAt.getTime();
  // A non-positive window means due at/behind the anchor: 1.0 iff already due.
  const fraction = windowMs <= 0 ? (overdue ? 1 : 0) : elapsedMs / windowMs;
  const seen = new Set(alreadyNotified);
  const newlyCrossed = ESCALATION_THRESHOLDS.filter(
    (t) => fraction >= t && !seen.has(t),
  );
  return { fractionElapsed: fraction, overdue, newlyCrossed };
}
