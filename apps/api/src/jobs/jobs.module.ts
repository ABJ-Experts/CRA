import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage';
import {
  NOTIFICATION_SENDER,
  WorkflowModule,
  type NotificationSender,
} from '../workflow';
import { defaultFeedSources } from '../vuln';
import { buildHandlers } from './handlers';
import { registerSchedules } from './scheduler';
import { closeQueue, startWorker } from './queue';
import type { Worker } from 'bullmq';

/**
 * ADR-001: "one deployable NestJS application ... plus a worker process built
 * from the same codebase". The worker is a second entrypoint over this same
 * module graph (see worker.main.ts), not a separate service — so a handler calls
 * exactly the domain code the HTTP path calls, with no duplicated logic to drift.
 */
@Injectable()
export class JobsService {
  private worker: Worker | null = null;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(NOTIFICATION_SENDER)
    private readonly notifications: NotificationSender,
  ) {}

  /**
   * Called only by the worker entrypoint. The API process enqueues but never
   * consumes: BRD §4.4 — "workers accept jobs and nothing else", and an API
   * process that also processed jobs would make request latency depend on
   * whatever SBOM someone uploaded a moment ago.
   */
  async startConsuming(): Promise<void> {
    const handlers = buildHandlers({
      storage: this.storage,
      notifications: this.notifications,
      feedSources: defaultFeedSources(),
    });
    this.worker = startWorker(handlers);
    await registerSchedules();
  }

  /** FR-JOB-006: in-flight jobs finish or return to the queue. */
  async shutdown(): Promise<void> {
    await closeQueue(this.worker ?? undefined);
    this.worker = null;
  }
}

@Global()
@Module({
  // WorkflowModule owns the NOTIFICATION_SENDER binding and is not itself
  // @Global, so the dependency is declared rather than assumed. Storage arrives
  // via the @Global StorageModule.
  imports: [WorkflowModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
