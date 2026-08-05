// Public interface (Facade) for the jobs module.
export {
  JOB,
  RETRY,
  SCHEDULES,
  TENANT_CONCURRENCY,
  WORKER_CONCURRENCY,
  type JobEnvelope,
  type JobName,
  type JobPayload,
  type SbomIngestPayload,
  type SbomMatchPayload,
  type FeedSyncPayload,
  type VulnReevaluatePayload,
  type ObligationTickPayload,
  type NotificationDispatchPayload,
  type ScheduleFanoutPayload,
} from './job-catalogue';
export {
  InvalidEnvelopeError,
  assertEnvelope,
  enqueue,
  enqueueOnce,
  queue,
  queueMetrics,
  replayDeadLettered,
  startWorker,
  closeQueue,
  type HandlerSpec,
  type JobHandler,
} from './queue';
export { buildHandlers, envelopeFor, type JobDeps } from './handlers';
export { fanOutPerTenant, registerSchedules } from './scheduler';
export { JobsModule, JobsService } from './jobs.module';
