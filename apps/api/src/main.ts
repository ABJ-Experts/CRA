import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";

import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { API_PREFIX } from "./auth/cookies.util";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Our own filter shapes every error; Nest's default would double-log 5xx.
    bufferLogs: false,
  });
  const config = app.get(ConfigService);
  const logger = new Logger("Bootstrap");

  /*
   * Every route lives under /api/v1. This is not cosmetic:
   *   - REFRESH_COOKIE_PATH is derived from it, so the browser only sends the
   *     refresh token to the refresh endpoint.
   *   - apps/web's MSW mocks already own /api/products, /api/orders,
   *     /api/customers and /api/coins. A proxy at /api/* would collide with
   *     them, and the failure would be intermittent and environment-dependent.
   */
  app.setGlobalPrefix(API_PREFIX);

  /*
   * Trust exactly one proxy hop (the Next rewrite in front of us), so
   * req.ip is the real client address for rate limiting rather than the proxy's.
   * An integer, never `true`: trusting every hop lets a client spoof
   * X-Forwarded-For and sidestep per-IP throttling entirely.
   */
  app.set("trust proxy", 1);

  app.use(cookieParser());
  app.use(
    helmet({
      // This is a JSON API; it never serves a document, so CSP has nothing to
      // protect and its default directives break nothing but also do nothing.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  const webOrigin = config.getOrThrow<string>("WEB_ORIGIN");

  /*
   * `credentials: true` is mandatory. Without it the browser silently drops the
   * Set-Cookie on every auth response, and sign-in appears to succeed while no
   * session ever materialises.
   *
   * Normal browser traffic arrives through the Next rewrite proxy and is
   * therefore same-origin — CORS is here for direct calls (curl, tests, and a
   * future separate client).
   */
  app.enableCors({
    origin: [webOrigin],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  app.useGlobalFilters(new AllExceptionsFilter());

  /*
   * NO global Nest ValidationPipe here, deliberately.
   *
   * It requires class-validator/class-transformer, which would give this app a
   * SECOND validation system alongside the Zod schemas in @repo/contracts —
   * and those schemas are the ones apps/web's frozen auth screens already
   * enforce. Two systems means two sets of rules to keep in step, and the day
   * they diverge the server is laxer than the client.
   *
   * Every endpoint validates its body with `zodBody(schema)` instead, which
   * also emits `fieldErrors` in exactly the shape the screens expect.
   */
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>("PORT");
  await app.listen(port);

  logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`);
  logger.log(`CORS origin: ${webOrigin}`);
}

void bootstrap();
