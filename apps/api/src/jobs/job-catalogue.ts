// BRD §14.1 — the job catalogue. Names, payload shapes, concurrency caps and
// schedules in one place, so "what runs, how often, how hard" is answerable
// without reading five handlers.

/**
 * FR-JOB-001: every payload carries the tenant, the correlation id that ties the
 * job back to the request that caused it, and the actor on whose behalf it runs.
 * A job without a tenant id is rejected and dead-lettered rather than guessed at.
 *
 * `organisationId` is null ONLY for genuinely global work (the feed syncs that
 * write the shared advisory mirror). Everything else must carry one.
 */
export interface JobEnvelope {
  organisationId: string | null;
  correlationId: string;
  actorId: string | null;
}

export const JOB = {
  SBOM_INGEST: 'sbom.ingest',
  SBOM_MATCH: 'sbom.match',
  FEED_SYNC: 'feed.sync',
  VULN_REEVALUATE: 'vuln.reevaluate',
  OBLIGATION_TICK: 'obligation.tick',
  NOTIFICATION_DISPATCH: 'notification.dispatch',
  /**
   * The only genuinely tenant-less job: a global heartbeat that expands into one
   * tenant-scoped job per organisation. Kept as its own name so every OTHER job
   * can be unconditionally required to carry an organisationId (FR-JOB-001) —
   * the fan-out is the single, explicit exception rather than a hole in the rule.
   */
  SCHEDULE_FANOUT: 'schedule.fanout',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export interface SbomIngestPayload extends JobEnvelope {
  organisationId: string;
  productReleaseId: string;
  document: string;
  source?: string;
}

export interface SbomMatchPayload extends JobEnvelope {
  organisationId: string;
  productReleaseId: string;
}

export interface FeedSyncPayload extends JobEnvelope {
  feed: 'osv' | 'nvd' | 'ghsa' | 'kev' | 'epss';
  /** OSV is demand-seeded per tenant; the global feeds ignore this. */
  organisationId: string | null;
}

export interface VulnReevaluatePayload extends JobEnvelope {
  organisationId: string;
  advisoryIds: string[];
}

export interface ObligationTickPayload extends JobEnvelope {
  organisationId: string;
  /**
   * Always absent in production. The tick reads the clock itself; accepting a
   * caller-supplied "now" over the wire would let a client move a regulatory
   * deadline, which §11 treats as a correctness problem, not a convenience.
   */
  now?: never;
}

export interface NotificationDispatchPayload extends JobEnvelope {
  organisationId: string;
  category: 'obligation_deadline' | 'finding_state';
  subject: string;
  body: string;
  recipients: string[];
}

export interface ScheduleFanoutPayload extends JobEnvelope {
  organisationId: null;
  target: 'obligation.tick' | 'feed.sync.osv';
}

export type JobPayload =
  | ScheduleFanoutPayload
  | SbomIngestPayload
  | SbomMatchPayload
  | FeedSyncPayload
  | VulnReevaluatePayload
  | ObligationTickPayload
  | NotificationDispatchPayload;

/**
 * FR-JOB-004 — per-tenant concurrency caps, so one large tenant cannot starve
 * the others. Values from §14.1.
 *
 * Enforced by an in-process semaphore (see queue.ts). That is exact for the
 * single-worker deployments the MVP targets; across several worker replicas the
 * effective cap is this value times the replica count. Making it globally exact
 * needs a Redis-backed semaphore or BullMQ's group feature — recorded here rather
 * than discovered later from a support ticket.
 */
export const TENANT_CONCURRENCY: Record<JobName, number> = {
  [JOB.SBOM_INGEST]: 4,
  [JOB.SBOM_MATCH]: 2,
  [JOB.FEED_SYNC]: 1,
  [JOB.VULN_REEVALUATE]: 2,
  [JOB.OBLIGATION_TICK]: 1,
  [JOB.NOTIFICATION_DISPATCH]: 10,
  [JOB.SCHEDULE_FANOUT]: 1,
};

/** Worker-level parallelism, the ceiling across all tenants for a job type. */
export const WORKER_CONCURRENCY: Record<JobName, number> = {
  [JOB.SBOM_INGEST]: 8,
  [JOB.SBOM_MATCH]: 4,
  [JOB.FEED_SYNC]: 2,
  [JOB.VULN_REEVALUATE]: 4,
  [JOB.OBLIGATION_TICK]: 4,
  [JOB.NOTIFICATION_DISPATCH]: 20,
  [JOB.SCHEDULE_FANOUT]: 2,
};

/**
 * Repeatable schedules (§14.1).
 *
 * obligation.tick at one minute is load bearing: NFR-005 requires a threshold
 * notification within 60s of the threshold being crossed, and the tick is the
 * only thing that notices.
 */
export const SCHEDULES = {
  obligationTick: { every: 60_000 },
  feedKev: { pattern: '0 * * * *' }, // hourly — KEV is the reporting trigger
  feedDaily: { pattern: '17 3 * * *' }, // off the hour; upstreams rate-limit
} as const;

/**
 * FR-JOB-003 — retry with exponential backoff plus a bounded attempt count.
 * Exhausted jobs stay in the failed set as the dead letter queue, with an
 * operator-visible replay (see queue.ts `replayDeadLettered`).
 */
export const RETRY = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  // Keep failures indefinitely — a silently evicted failure is a lost deadline.
  removeOnFail: false,
  removeOnComplete: { count: 1_000 },
};
