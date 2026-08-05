// The worker entrypoint (ADR-001, BRD §14).
//
// Same module graph as the API, no HTTP listener. BRD §4.4: the worker tier
// "accepts jobs and nothing else" — it has no inbound public surface at all,
// which is why this uses createApplicationContext rather than NestFactory.create.
import './env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JobsService } from './jobs';
import { assertRlsBootSafety, closeDb } from './db';

async function bootstrap(): Promise<void> {
  // SEC-014 applies here exactly as it does to the API. A worker running as a
  // role that can bypass RLS would process every tenant's jobs against every
  // tenant's data, and nothing would fail loudly enough to notice.
  await assertRlsBootSafety();

  const app = await NestFactory.createApplicationContext(AppModule, {
    // Jobs log structured JSON (FR-OBS-001); Nest's boot chatter is noise here.
    logger: ['error', 'warn', 'log'],
  });

  const jobs = app.get(JobsService);
  await jobs.startConsuming();

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'worker ready',
      queue: 'cra-sentinel',
    }),
  );

  // FR-JOB-006: graceful shutdown. In-flight jobs are allowed to finish or
  // return to the queue, so a deploy never silently loses work.
  let shuttingDown = false;
  const stop = (signal: string) => {
    void (async () => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(
        JSON.stringify({ level: 'info', message: 'worker draining', signal }),
      );
      await jobs.shutdown();
      await app.close();
      await closeDb();
      process.exit(0);
    })();
  };

  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

bootstrap().catch((e: unknown) => {
  console.error('Worker failed to start:', e);
  process.exit(1);
});
