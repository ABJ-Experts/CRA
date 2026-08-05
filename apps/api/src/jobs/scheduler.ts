// FR-SLA-005/007 — the schedule, and the fan-out from a global heartbeat to
// per-tenant work. This is the piece whose absence made the whole obligation
// engine inert: the arithmetic was correct and tested, but nothing ever asked it
// what time it was.
import { randomUUID } from 'node:crypto';
import { listOrganisationIds } from '../db';
import { JOB, SCHEDULES } from './job-catalogue';
import { enqueue, queue } from './queue';

const SCHEDULE_ENVELOPE = {
  organisationId: null,
  correlationId: 'schedule',
  actorId: null,
} as const;

/**
 * Register the repeatable schedules. Idempotent: BullMQ keys a repeatable job on
 * its jobId, so calling this on every worker boot re-asserts the schedule rather
 * than stacking duplicates — which matters because every replica calls it.
 */
export async function registerSchedules(): Promise<void> {
  const q = queue();

  // The heartbeat. It does no tenant work itself; it expands into one tick per
  // organisation, so a tenant with 10,000 obligations cannot delay another
  // tenant's countdown.
  await q.add(
    JOB.SCHEDULE_FANOUT,
    { ...SCHEDULE_ENVELOPE, target: 'obligation.tick' },
    {
      repeat: { every: SCHEDULES.obligationTick.every },
      jobId: 'schedule:obligation-tick-fanout',
      // A missed heartbeat is not worth replaying: the next one recomputes from
      // the database anyway, so a backlog would emit nothing new.
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );

  // KEV hourly — it is the FR-VULN-011 reporting trigger, so staleness here has
  // regulatory consequences the other feeds do not.
  await q.add(
    JOB.FEED_SYNC,
    { ...SCHEDULE_ENVELOPE, feed: 'kev' },
    {
      repeat: { pattern: SCHEDULES.feedKev.pattern },
      jobId: 'schedule:feed-kev',
      removeOnComplete: true,
    },
  );

  for (const feed of ['nvd', 'ghsa', 'epss'] as const) {
    await q.add(
      JOB.FEED_SYNC,
      { ...SCHEDULE_ENVELOPE, feed },
      {
        repeat: { pattern: SCHEDULES.feedDaily.pattern },
        jobId: `schedule:feed-${feed}`,
        removeOnComplete: true,
      },
    );
  }

  // OSV is demand-seeded from each tenant's own package set, so it fans out too.
  await q.add(
    JOB.SCHEDULE_FANOUT,
    { ...SCHEDULE_ENVELOPE, target: 'feed.sync.osv' },
    {
      repeat: { pattern: SCHEDULES.feedDaily.pattern },
      jobId: 'schedule:feed-osv-fanout',
      removeOnComplete: true,
    },
  );
}

/**
 * Expand one global heartbeat into one tenant-scoped job per organisation.
 *
 * Deliberately not a single cross-tenant query: every handler runs inside
 * withTenant, so the RLS context is re-established per organisation and a bug in
 * one tenant's data cannot spill into another's results (BRD §6.3).
 */
export async function fanOutPerTenant(
  target: 'obligation.tick' | 'feed.sync.osv',
): Promise<number> {
  const organisationIds = await listOrganisationIds();
  const correlationId = randomUUID();
  // Minute bucket: two heartbeats inside the same minute collapse onto one tick
  // per tenant (FR-JOB-002). Nothing is lost — the tick recomputes from the
  // database, so a collapsed duplicate would have found the same state.
  const minute = Math.floor(Date.now() / 60_000);

  for (const organisationId of organisationIds) {
    if (target === 'obligation.tick') {
      await enqueue(
        JOB.OBLIGATION_TICK,
        { organisationId, correlationId, actorId: null },
        { jobId: `tick:${organisationId}:${minute}` },
      );
    } else {
      await enqueue(JOB.FEED_SYNC, {
        organisationId,
        correlationId,
        actorId: null,
        feed: 'osv',
      });
    }
  }

  return organisationIds.length;
}
