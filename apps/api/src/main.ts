import './env'; // load .env.local before anything reads process.env
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { assertRlsBootSafety } from './db/sec014';

async function bootstrap(): Promise<void> {
  // SEC-014: refuse to start if RLS isolation could be silently disabled.
  await assertRlsBootSafety();

  const app = await NestFactory.create(AppModule);
  // ADR-002: the browser calls this API directly (never PostgREST). Allow the web
  // origin + the auth/tenant headers. Origins are configurable for other envs.
  const webOrigins = (
    process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3000,http://localhost:3000'
  )
    .split(',')
    .map((o) => o.trim());
  app.enableCors({
    origin: webOrigins,
    allowedHeaders: ['authorization', 'content-type', 'x-organisation-id'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  // 3000 is apps/web and 3001 is apps/docs, so the fallback must be 3333 to
  // match .env.example and the root README. A 3001 default silently collided
  // with Docusaurus whenever PORT was unset.
  const port = Number(process.env.PORT ?? 3333);
  await app.listen(port);
  new Logger('Bootstrap').log(
    `CRA Sentinel API listening on :${port} (SEC-014 RLS boot assertion passed)`,
  );
}

bootstrap().catch((err: unknown) => {
  new Logger('Bootstrap').error(err);
  process.exit(1);
});
