import { readFile, stat } from "node:fs/promises";
import { constants as cryptoConstants } from "node:crypto";
import { Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { API_PREFIX } from "./auth/cookies.util";
import { AgentIngressModule } from "./connectors/agent/agent-ingress.module";
import { SupabaseAgentRepository } from "./connectors/agent/supabase-agent.repository";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

async function requiredFile(name: string, privateKey = false): Promise<Buffer> {
  const path = process.env[name];
  if (!path) throw new Error(`${name} must name a mounted file`);
  const details = await stat(path);
  if (!details.isFile() || (privateKey && (details.mode & 0o077) !== 0))
    throw new Error(
      `${name} must be a regular file${privateKey ? " accessible only to its owner" : ""}`,
    );
  return readFile(path);
}

async function bootstrap(): Promise<void> {
  // TLS options must be read before NestFactory.create, unlike normal DI config.
  await ConfigModule.forRoot({ envFilePath: [".env.local", ".env"] });
  const [serverKey, serverCert, caCert] = await Promise.all([
    requiredFile("AGENT_TLS_KEY_PATH", true),
    requiredFile("AGENT_TLS_CERT_PATH"),
    requiredFile("AGENT_CA_CERT_PATH"),
    requiredFile("AGENT_CA_KEY_PATH", true),
  ]);
  if (!process.env.CONNECTOR_VAULT_KEYRING)
    throw new Error("CONNECTOR_VAULT_KEYRING is required for agent ingress");
  const app = await NestFactory.create<NestExpressApplication>(
    AgentIngressModule,
    {
      rawBody: true,
      httpsOptions: {
        key: serverKey,
        cert: serverCert,
        ca: caCert,
        requestCert: true,
        secureOptions:
          cryptoConstants.SSL_OP_NO_TLSv1 | cryptoConstants.SSL_OP_NO_TLSv1_1,
        // Enrollment has only a scoped one-time token. Frames require an
        // authorized peer certificate and reject absent/invalid peers in code.
        rejectUnauthorized: false,
      },
    },
  );
  app.setGlobalPrefix(API_PREFIX);
  app.useBodyParser("json", { limit: "4100kb" });
  app.set("trust proxy", false);
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  const port = Number.parseInt(process.env.AGENT_INGRESS_PORT ?? "3443", 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("AGENT_INGRESS_PORT must be a TCP port");
  await app.listen(port);
  const repository = app.get(SupabaseAgentRepository);
  const maintenance = setInterval(() => {
    void repository.pruneExpiredNonces().catch(() => {
      new Logger("AgentIngress").warn(
        "Agent nonce maintenance is temporarily unavailable",
      );
    });
  }, 60 * 60_000);
  maintenance.unref();
  new Logger("AgentIngress").log(`Agent ingress listening on TLS port ${port}`);
}

void bootstrap();
