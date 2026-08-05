// FR-SLA-005/006: pure escalation-threshold evaluation (§11.4). No DB, no clock.
import { describe, it, expect } from 'vitest';
import { evaluateStage, ESCALATION_THRESHOLDS } from './obligation-tick';

const anchor = new Date('2026-01-01T00:00:00Z');
const due = new Date('2026-01-02T00:00:00Z'); // 24h window
const at = (hours: number): Date =>
  new Date(anchor.getTime() + hours * 3_600_000);

describe('evaluateStage — escalation thresholds', () => {
  it('exposes the documented §11.4 thresholds', () => {
    expect([...ESCALATION_THRESHOLDS]).toEqual([0.5, 0.75, 0.9, 1.0]);
  });

  it('crosses 0.5 at the half-way point (not overdue)', () => {
    const r = evaluateStage(anchor, due, at(12), []);
    expect(r.newlyCrossed).toEqual([0.5]);
    expect(r.overdue).toBe(false);
    expect(r.fractionElapsed).toBeCloseTo(0.5);
  });

  it('crosses only the newly-reached threshold (0.75) given prior notifications', () => {
    const r = evaluateStage(anchor, due, at(18), [0.5]);
    expect(r.newlyCrossed).toEqual([0.75]);
  });

  it('is idempotent — re-evaluating with the same state crosses nothing', () => {
    const r = evaluateStage(anchor, due, at(12), [0.5]);
    expect(r.newlyCrossed).toEqual([]);
  });

  it('marks overdue and fires 1.0 at the deadline', () => {
    const r = evaluateStage(anchor, due, at(24), [0.5, 0.75, 0.9]);
    expect(r.newlyCrossed).toEqual([1.0]);
    expect(r.overdue).toBe(true);
  });

  it('a first tick after the deadline crosses every threshold at once', () => {
    const r = evaluateStage(anchor, due, at(30), []);
    expect(r.newlyCrossed).toEqual([0.5, 0.75, 0.9, 1.0]);
    expect(r.overdue).toBe(true);
  });

  it('a non-positive window is overdue exactly at/after the due instant', () => {
    const zero = evaluateStage(anchor, anchor, anchor, []);
    expect(zero.overdue).toBe(true);
    expect(zero.newlyCrossed).toEqual([0.5, 0.75, 0.9, 1.0]);
  });
});
