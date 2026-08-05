// FR-JOB-001/002 — the guarantees the queue itself has to provide, independent
// of any handler. Envelope validation is pure; the fan-out and dedup assertions
// run against real Redis and real Postgres.
import '../env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { ensureUserAccount } from '../identity';
import { createOrganisation } from '../org';
import { listOrganisationIds, closeDb } from '../db';
import { JOB, type JobEnvelope } from './job-catalogue';
import {
  InvalidEnvelopeError,
  assertEnvelope,
  closeQueue,
  queue,
} from './queue';
import { fanOutPerTenant } from './scheduler';

describe('FR-JOB-001 — a job never guesses its tenant', () => {
  it('rejects a tenant-scoped payload with no organisationId', () => {
    expect(() =>
      assertEnvelope(JOB.OBLIGATION_TICK, { correlationId: 'c1' }, true),
    ).toThrow(InvalidEnvelopeError);
    // The message has to name the problem: this lands in a dead letter queue an
    // operator reads at 02:00.
    expect(() =>
      assertEnvelope(JOB.OBLIGATION_TICK, { correlationId: 'c1' }, true),
    ).toThrow(/no organisationId/);
  });

  it('rejects any payload with no correlationId', () => {
    // Without it a job cannot be traced back to the request that caused it,
    // which FR-API-004 requires across every log line, job and audit event.
    expect(() =>
      assertEnvelope(JOB.SBOM_MATCH, { organisationId: uuidv7() }, true),
    ).toThrow(/no correlationId/);
  });

  it('rejects an empty or absent payload rather than defaulting', () => {
    expect(() => assertEnvelope(JOB.SBOM_INGEST, undefined, true)).toThrow(
      InvalidEnvelopeError,
    );
    expect(() => assertEnvelope(JOB.SBOM_INGEST, {}, true)).toThrow(
      InvalidEnvelopeError,
    );
  });

  it('allows a null tenant only for jobs declared global', () => {
    const envelope = assertEnvelope(
      JOB.FEED_SYNC,
      { correlationId: 'c1' },
      false,
    );
    expect(envelope.organisationId).toBeNull();
    expect(envelope.actorId).toBeNull();
  });
});

describe('FR-SLA-007 — the heartbeat fans out to every tenant', () => {
  let orgId: string;

  /**
   * Empty the queue and hold it, so nothing can consume what the fan-out puts in.
   *
   * These assertions count what is SITTING in the queue, and a developer running
   * `pnpm --filter api worker:dev` is a completely ordinary state — that
   * worker drains the fan-out faster than the assertion can read it, and the
   * suite then fails with a mystifying "expected 0 to be 558" that reads like a
   * fan-out bug rather than a consumer.
   *
   * Order matters: obliterate() CLEARS the paused flag, so pausing first
   * achieves nothing. Pause after.
   */
  async function drainAndHold(): Promise<void> {
    await queue().obliterate({ force: true });
    await queue().pause();
  }

  beforeAll(async () => {
    const userId = await ensureUserAccount(
      uuidv7(),
      `job-${uuidv7().slice(0, 8)}@acme.test`,
    );
    orgId = (
      await createOrganisation(userId, {
        legalName: `JobCo-${uuidv7().slice(0, 8)}`,
        countryMainEstablishment: 'DE',
      })
    ).id;
  });

  afterAll(async () => {
    await queue().obliterate({ force: true });
    await queue().resume();
    await closeQueue();
    await closeDb();
  });

  it('enumerates tenants through the scheduler role, not cras_app', async () => {
    // cras_app cannot do this: the organisation RLS policy admits only rows the
    // caller is a member of, so a context-free query correctly returns zero.
    const ids = await listOrganisationIds();
    expect(ids).toContain(orgId);
  });

  it('enqueues one tenant-scoped tick per organisation', async () => {
    await drainAndHold();
    const tenants = await fanOutPerTenant('obligation.tick');
    expect(tenants).toBeGreaterThan(0);

    // Both buckets: a PAUSED queue routes newly added jobs to 'paused' rather
    // than 'waiting', so reading only 'waiting' reports zero. (0, -1) is "all"
    // — a fixed window silently caps the count once the dev database holds more
    // organisations than the window, which is a slow-motion false failure.
    const waiting = await queue().getJobs(['waiting', 'paused'], 0, -1);
    const ticks = waiting
      .filter((j) => j.name === JOB.OBLIGATION_TICK)
      .map((j) => j.data as JobEnvelope);
    expect(ticks.length).toBe(tenants);
    // Every fanned-out job carries a real tenant, so the guard above can be
    // unconditional for tick.
    expect(ticks.every((d) => Boolean(d.organisationId))).toBe(true);
    expect(ticks.some((d) => d.organisationId === orgId)).toBe(true);
  });

  it('FR-JOB-002 — two heartbeats in the same minute collapse to one tick per tenant', async () => {
    await drainAndHold();
    const first = await fanOutPerTenant('obligation.tick');
    await fanOutPerTenant('obligation.tick');

    const waiting = await queue().getJobs(['waiting', 'paused'], 0, -1);
    const ticks = waiting.filter((j) => j.name === JOB.OBLIGATION_TICK);
    // The minute-bucketed jobId makes the second fan-out a no-op. Nothing is
    // lost: the tick recomputes from the database, so a collapsed duplicate
    // would have found exactly the same state.
    expect(ticks.length).toBe(first);
  });
});
