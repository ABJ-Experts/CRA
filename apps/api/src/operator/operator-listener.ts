import {
  Module,
  type INestApplication,
  UnauthorizedException,
} from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { z } from "zod";
import helmet from "helmet";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ZodResponseInterceptor } from "../common/http/zod-response.interceptor";
import {
  OPERATOR_INSTANCE_ID,
  OperatorController,
  type OperatorRequest,
} from "./operator.controller";
import { OperatorRegistry } from "./operator-registry";
import type { RegistryReader } from "./operator-registry.client";
import {
  authorizeOperatorSocket,
  OperatorGrantStore,
  privateAddress,
} from "./operator-security";
import type { ServerOptions } from "node:https";
import { staticScriptHashes } from "./operator-static-policy";
import { extname } from "node:path";
import type { TLSSocket } from "node:tls";
import type { Response, NextFunction } from "express";
export interface OperatorListenerConfig {
  instanceId: string;
  host: string;
  port: number;
  ca: Buffer;
  cert: Buffer;
  key: Buffer;
  grantsPath: string;
  staticRoot: string;
}
@Module({ controllers: [OperatorController] })
export class OperatorIngressModule {}
export async function createOperatorApplication(
  config: OperatorListenerConfig,
  reader: RegistryReader,
): Promise<INestApplication> {
  z.uuid().parse(config.instanceId);
  if (!privateAddress(config.host))
    throw new Error("Operator listener requires a private bind address");
  const grants = new OperatorGrantStore(config.grantsPath);
  await grants.read();
  const httpsOptions = {
    ca: config.ca,
    cert: config.cert,
    key: config.key,
    minVersion: "TLSv1.2",
    requestCert: true,
    rejectUnauthorized: true,
  } satisfies ServerOptions;
  const app = await NestFactory.create<NestExpressApplication>(
    {
      module: OperatorIngressModule,
      providers: [
        { provide: OperatorRegistry, useValue: new OperatorRegistry(reader) },
        { provide: OPERATOR_INSTANCE_ID, useValue: config.instanceId },
      ],
    },
    { logger: false, bodyParser: false, httpsOptions },
  );
  app.set("trust proxy", false);
  app.setGlobalPrefix("api/v1");
  const recent = new Map<string, { start: number; count: number }>();
  app.use(
    (request: OperatorRequest, response: Response, next: NextFunction) => {
      void authorizeOperatorSocket(request.socket as TLSSocket, grants)
        .then((identity) => {
          const now = Date.now();
          const old = recent.get(identity.fingerprint256);
          const entry =
            old && now - old.start < 60000
              ? { ...old, count: old.count + 1 }
              : { start: now, count: 1 };
          recent.set(identity.fingerprint256, entry);
          if (recent.size > 1000) recent.delete(recent.keys().next().value!);
          if (entry.count > 120) {
            response
              .status(429)
              .json({ message: "Operator request limit exceeded" });
            return;
          }
          if (
            !request.path.startsWith("/api/v1/") &&
            ![
              "",
              ".html",
              ".css",
              ".js",
              ".svg",
              ".png",
              ".jpg",
              ".jpeg",
              ".webp",
              ".gif",
              ".ico",
              ".woff",
              ".woff2",
              ".ttf",
            ].includes(extname(request.path))
          ) {
            response.status(404).end();
            return;
          }
          request.operatorIdentity = identity;
          response.setHeader("Cache-Control", "no-store");
          next();
        })
        .catch((error: unknown) => {
          response
            .status(error instanceof UnauthorizedException ? 401 : 503)
            .json({ message: "Operator certificate denied" });
        });
    },
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: [
            "'self'",
            ...(await staticScriptHashes(config.staticRoot)),
          ],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
        },
      },
    }),
  );
  app.useStaticAssets(config.staticRoot, {
    index: "index.html",
    redirect: false,
    extensions: ["html"],
    dotfiles: "deny",
  });
  app.useGlobalInterceptors(new ZodResponseInterceptor(new Reflector()));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
