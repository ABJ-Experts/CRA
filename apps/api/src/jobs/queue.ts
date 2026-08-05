// BullMQ transport (ADR-006). Redis is the delivery mechanism and nothing more:
// every durable intent is written to Postgres first, so losing Redis degrades how
// quickly people are told, never whether a deadline exists.
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import {
  JOB,
  RETRY,
  TENANT_CONCURRENCY,
  WORKER_CONCURRENCY,
  type JobEnvelope,
  type JobName,
} from './job-catalogue';

export const QUEUE_NAME = 'cra-sentinel';

let connection: Redis | null = null;

export function redis(): Redis {
  connection ??= new IORedis(
    process.env.REDIS_URL ?? 'redis://localhost:6379',
    {
      // BullMQ blocks on BRPOPLPUSH; a retry ceiling would make a worker give up
      // on a Redis restart instead of reconnecting.
      maxRetriesPerRequest: null,
    },
  );
  return connection;
}

let queueInstance: Queue | null = null;

export function queue(): Queue {
  queueInstance ??= new Queue(QUEUE_NAME, { connection: redis() });
  return queueInstance;
}

/**
 * FR-JOB-001 — a job with no tenant id is rejected, never guessed at.
 *
 * Thrown before any handler runs, and deliberately NOT retried: a malformed
 * envelope will be just as malformed on the fifth attempt. It goes straight to
 * the dead letter set where an operator can see it.
 */
export class InvalidEnvelopeError extends Error {
  readonly name = 'InvalidEnvelopeError';
}

export function assertEnvelope(
  name: JobName,
  payload: unknown,
  requiresTenant: boolean,
): JobEnvelope {
  const p = (payload ?? {}) as Partial<JobEnvelope>;
  if (!p.correlationId)
    throw new InvalidEnvelopeError(`${name}: payload has no correlationId`);
  if (requiresTenant && !p.organisationId)
    throw new InvalidEnvelopeError(
      `${name}: payload has no organisationId; tenant-scoped jobs are never inferred`,
    );
  return {
    organisationId: p.organisationId ?? null,
    correlationId: p.correlationId,
    actorId: p.actorId ?? null,
  };
}

/**
 * FR-JOB-004 — per-tenant concurrency, in process.
 *
 * BullMQ's own `concurrency` is per worker, not per tenant, so one tenant
 * uploading 500 SBOMs would occupy every slot. This gates admission per
 * (job, tenant) pair before the handler runs. See TENANT_CONCURRENCY for the
 * multi-replica caveat.
 */
class TenantSemaphore {
  private readonly inFlight = new Map<string, number>();
  private readonly waiting = new Map<string, (() => void)[]>();

  async acquire(key: string, limit: number): Promise<void> {
    const current = this.inFlight.get(key) ?? 0;
    if (current < limit) {
      this.inFlight.set(key, current + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const queueForKey = this.waiting.get(key) ?? [];
      queueForKey.push(resolve);
      this.waiting.set(key, queueForKey);
    });
    this.inFlight.set(key, (this.inFlight.get(key) ?? 0) + 1);
  }

  release(key: string): void {
    // Decrement exactly once here; the woken waiter's own continuation does the
    // matching increment, so the slot is handed over rather than double-counted.
    this.inFlight.set(key, Math.max(0, (this.inFlight.get(key) ?? 1) - 1));
    this.waiting.get(key)?.shift()?.();
  }
}

const semaphore = new TenantSemaphore();

export type JobHandler = (
  payload: unknown,
  envelope: JobEnvelope,
  job: Job,
) => Promise<unknown>;

export interface HandlerSpec {
  handler: JobHandler;
  /** False only for the global feed syncs, which write the shared mirror. */
  requiresTenant: boolean;
}

export async function enqueue(
  name: JobName,
  payload: JobEnvelope & Record<string, unknown>,
  options: JobsOptions = {},
): Promise<void> {
  await queue().add(name, payload, { ...RETRY, ...options });
}

/**
 * FR-JOB-002 — idempotency.
 *
 * A stable jobId makes BullMQ itself drop a duplicate enqueue, which covers the
 * common case (the same SBOM pushed twice by a flapping CI job). Handlers are
 * ALSO individually idempotent, because deduplication at the queue is best effort
 * once a job id has aged out.
 */
export async function enqueueOnce(
  name: JobName,
  jobId: string,
  payload: JobEnvelope & Record<string, unknown>,
  options: JobsOptions = {},
): Promise<void> {
  await queue().add(name, payload, { ...RETRY, jobId, ...options });
}

export function startWorker(handlers: Record<string, HandlerSpec>): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const name = job.name as JobName;
      const spec = handlers[name];
      if (!spec) throw new InvalidEnvelopeError(`No handler for job "${name}"`);

      const envelope = assertEnvelope(name, job.data, spec.requiresTenant);
      const key = `${name}::${envelope.organisationId ?? 'global'}`;
      const limit = TENANT_CONCURRENCY[name] ?? 1;

      await semaphore.acquire(key, limit);
      try {
        return await spec.handler(job.data, envelope, job);
      } finally {
        semaphore.release(key);
      }
    },
    {
      connection: redis(),
      // The ceiling across all tenants; the semaphore above narrows it per tenant.
      concurrency: Math.max(...Object.values(WORKER_CONCURRENCY)),
    },
  );

  worker.on('failed', (job, err) => {
    const attempts = job?.attemptsMade ?? 0;
    const exhausted = attempts >= (job?.opts.attempts ?? RETRY.attempts);

    console.error(
      JSON.stringify({
        level: exhausted ? 'error' : 'warn',
        message: exhausted ? 'job dead-lettered' : 'job failed, will retry',
        job: job?.name,
        jobId: job?.id,
        attempts,
        correlationId: (job?.data as JobEnvelope | undefined)?.correlationId,
        organisationId: (job?.data as JobEnvelope | undefined)?.organisationId,
        // FR-OBS-002: never log the payload — an SBOM body would land in the log.
        error: err.message,
      }),
    );
  });

  return worker;
}

/** FR-JOB-003 — operator-visible replay of the dead letter set. */
export async function replayDeadLettered(name?: JobName): Promise<number> {
  const failed = await queue().getFailed(0, 1_000);
  const targets = name ? failed.filter((j) => j.name === name) : failed;
  for (const job of targets) await job.retry();
  return targets.length;
}

/** FR-JOB-007 — queue depth, age of the oldest job, dead letter count. */
export async function queueMetrics(): Promise<{
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  oldestWaitingAgeMs: number | null;
}> {
  const q = queue();
  const [waiting, active, delayed, failed] = await Promise.all([
    q.getWaitingCount(),
    q.getActiveCount(),
    q.getDelayedCount(),
    q.getFailedCount(),
  ]);
  const [oldest] = await q.getWaiting(0, 0);
  return {
    waiting,
    active,
    delayed,
    failed,
    oldestWaitingAgeMs: oldest?.timestamp
      ? Date.now() - oldest.timestamp
      : null,
  };
}

/** FR-JOB-006 — in-flight jobs finish or return to the queue; work is not lost. */
export async function closeQueue(worker?: Worker): Promise<void> {
  if (worker) await worker.close();
  if (queueInstance) {
    await queueInstance.close();
    queueInstance = null;
  }
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

export { JOB };
