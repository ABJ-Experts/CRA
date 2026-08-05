// BRD §11.5 timer test matrix — the mandatory cases, all pure (no DB). "A
// beautiful countdown showing the wrong date is worse than no countdown at all."
import { describe, it, expect } from 'vitest';
import {
  computeDueAt,
  addCalendarMonths,
  parseIsoDuration,
} from './obligation-clock';

const iso = (d: Date): string => d.toISOString();

describe('§11.5 — obligation deadline arithmetic', () => {
  it('basic 24 hour: awareness 14 Apr 09:20 UTC -> early warning 15 Apr 09:20 UTC', () => {
    expect(iso(computeDueAt(new Date('2026-04-14T09:20:00Z'), 'PT24H'))).toBe(
      '2026-04-15T09:20:00.000Z',
    );
  });

  it('72 hour anchored to awareness: 14 Apr 09:20 -> notification 17 Apr 09:20', () => {
    expect(iso(computeDueAt(new Date('2026-04-14T09:20:00Z'), 'PT72H'))).toBe(
      '2026-04-17T09:20:00.000Z',
    );
  });

  it('final report anchored to remediation: 24 Apr 16:00 + 14d -> 08 May 16:00', () => {
    expect(iso(computeDueAt(new Date('2026-04-24T16:00:00Z'), 'P14D'))).toBe(
      '2026-05-08T16:00:00.000Z',
    );
  });

  it('severe-incident month: notification 17 Apr 08:00 + 1 month -> 17 May 08:00', () => {
    expect(iso(computeDueAt(new Date('2026-04-17T08:00:00Z'), 'P1M'))).toBe(
      '2026-05-17T08:00:00.000Z',
    );
  });

  it('month end: 31 Jan 10:00 + 1 month -> 28 Feb 10:00 (non-leap year)', () => {
    expect(iso(computeDueAt(new Date('2027-01-31T10:00:00Z'), 'P1M'))).toBe(
      '2027-02-28T10:00:00.000Z',
    );
  });

  it('month end in a leap year: 31 Jan 2028 + 1 month -> 29 Feb 2028', () => {
    expect(iso(computeDueAt(new Date('2028-01-31T10:00:00Z'), 'P1M'))).toBe(
      '2028-02-29T10:00:00.000Z',
    );
  });

  it('DST transition: +24h across the Europe/Berlin clock change is exactly 24h in UTC', () => {
    // 24 Mar 2029 01:30 UTC + 24h — UTC has no DST, so elapsed time is exact; a
    // local display would shift one hour and that is correct.
    const due = computeDueAt(new Date('2029-03-24T01:30:00Z'), 'PT24H');
    expect(due.getTime() - new Date('2029-03-24T01:30:00Z').getTime()).toBe(
      24 * 3_600_000,
    );
    expect(iso(due)).toBe('2029-03-25T01:30:00.000Z');
  });

  it('leap year: awareness 28 Feb 2028 09:20 + 72h -> 02 Mar 2028 (29 Feb exists)', () => {
    expect(iso(computeDueAt(new Date('2028-02-28T09:20:00Z'), 'PT72H'))).toBe(
      '2028-03-02T09:20:00.000Z',
    );
  });
});

describe('helpers', () => {
  it('parseIsoDuration handles the rule-set forms and rejects others', () => {
    expect(parseIsoDuration('PT24H')).toEqual({
      hours: 24,
      days: 0,
      months: 0,
    });
    expect(parseIsoDuration('P14D')).toEqual({ hours: 0, days: 14, months: 0 });
    expect(parseIsoDuration('P1M')).toEqual({ hours: 0, days: 0, months: 1 });
    expect(() => parseIsoDuration('banana')).toThrow();
  });

  it('addCalendarMonths clamps to the last day of the target month', () => {
    expect(iso(addCalendarMonths(new Date('2026-01-31T00:00:00Z'), 1))).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });
});
