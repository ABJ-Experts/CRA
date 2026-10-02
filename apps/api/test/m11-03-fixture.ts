import "./m11-03-environment";
import "reflect-metadata";
import { timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { z } from "zod";
import { AppModule } from "../src/app.module";
import { NodeWebhookTransport } from "../src/connectors/infrastructure/node-webhook-transport";
import { SupabaseWebhookRepository } from "../src/connectors/infrastructure/supabase-webhook.repository";
import { WebhookDeliveryWorker } from "../src/connectors/worker/webhook-delivery-worker";
import { ConnectorSyncWorker } from "../src/connectors/worker/connector-sync-worker";
import { SupabaseConnectorRepository } from "../src/connectors/infrastructure/supabase-connector.repository";
import { SupabaseService } from "../src/supabase/supabase.service";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { M1103Receiver } from "./m11-03-receiver";

/** Launch from apps/api. Runtime credentials are read in memory; none are written or logged. */
export async function startM1103Fixture() {
  const token = process.env.M1103_CONTROL_TOKEN;
  if (!token || token.length < 32)
    throw new Error(
      "M1103_CONTROL_TOKEN must be an ephemeral token of at least 32 characters",
    );
  const receiver = await M1103Receiver.start();
  let scope: string | undefined;
  let running = false;
  let workerActive = false;
  let workerDelayMs = 0;
  let tickFailure = false;
  let closeApp = async () => {};
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NodeWebhookTransport)
      .useValue(receiver.transport)
      .compile();
    const repository = module.get(SupabaseWebhookRepository);
    repository.dueOrganizations = () => Promise.resolve(scope ? [scope] : []);
    let connectorScopes: readonly string[] = [];
    const connectorRepository = module.get(SupabaseConnectorRepository);
    connectorRepository.listDueSyncRunOrganizations = () =>
      Promise.resolve(
        connectorScopes.map((organization_id) => ({ organization_id })),
      );
    const connectorWorker = module.get(ConnectorSyncWorker);
    let connectorRunning = false;
    const app = module.createNestApplication<NestExpressApplication>({
      logger: ["error", "warn"],
    });
    closeApp = () => app.close();
    app.setGlobalPrefix("api/v1");
    app.useBodyParser("json", { limit: "2200kb" });
    app.set("trust proxy", 1);
    app.use(cookieParser());
    app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
      }),
    );
    app.enableCors({
      origin: process.env.M1103_WEB_ORIGIN ?? "http://localhost:3011",
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(Number(process.env.M1103_API_PORT ?? 3339), "127.0.0.1");
    const worker = module.get(WebhookDeliveryWorker);
    const supabase = module.get(SupabaseService).admin();
    const configuration = z
      .object({
        organizationId: z.uuid(),
        keys: z
          .array(
            z
              .object({
                keyId: z.uuid(),
                secret: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
              })
              .strict(),
          )
          .max(2),
        behavior: z.enum(["success", "outage", "rate_limit", "timeout"]),
        workerActive: z.boolean(),
        workerDelayMs: z.number().int().min(0).max(1000).default(0),
      })
      .strict();
    const control = createServer((req, res) => {
      const received = Buffer.from(
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : "",
      );
      const expected = Buffer.from(`Bearer ${token}`);
      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const respond = (status: number, body: unknown) => {
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(body));
      };
      if (req.method === "GET" && req.url === "/state") {
        respond(200, {
          captures: receiver.captures,
          workerActive,
          tickFailure,
          organizationId: scope ?? null,
        });
        return;
      }
      if (
        req.method !== "POST" ||
        !["/configure", "/seed", "/register-connector-regression"].includes(
          req.url ?? "",
        )
      ) {
        respond(404, {});
        return;
      }
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
        if (raw.length > 4096) req.destroy();
      });
      req.on("end", () => {
        void (async () => {
          try {
            if (req.url === "/register-connector-regression") {
              const input = z
                .object({ organizationId: z.uuid() })
                .strict()
                .parse(JSON.parse(raw));
              const { data, error } = await supabase
                .from("organizations")
                .select("name")
                .eq("id", input.organizationId)
                .single();
              if (
                error ||
                !data.name.startsWith("E2E Connector Sync ") ||
                connectorScopes.length >= 2
              )
                throw new Error("Wrong connector regression tenant");
              connectorScopes = [
                ...new Set([...connectorScopes, input.organizationId]),
              ];
              respond(200, { registered: true });
              return;
            }
            if (req.url === "/seed") {
              const input = z
                .object({
                  organizationId: z.uuid(),
                  productId: z.uuid(),
                  releaseId: z.uuid(),
                  count: z.number().int().min(1).max(1000),
                })
                .strict()
                .parse(JSON.parse(raw));
              if (!scope || input.organizationId !== scope)
                throw new Error("Wrong fixture tenant");
              const { data, error } = await supabase
                .from("product_releases")
                .select("id")
                .eq("organization_id", scope)
                .eq("product_id", input.productId)
                .eq("id", input.releaseId)
                .single();
              if (error || !data) throw new Error("Wrong fixture release");
              const container =
                process.env.M1103_DB_CONTAINER ?? "supabase_db_cra";
              if (!/^supabase_db_[a-zA-Z0-9_-]+$/.test(container))
                throw new Error("Invalid local container");
              const result = spawnSync(
                "docker",
                [
                  "exec",
                  "-i",
                  container,
                  "psql",
                  "-U",
                  "postgres",
                  "-d",
                  "postgres",
                  "-v",
                  "ON_ERROR_STOP=1",
                ],
                {
                  input: `begin; insert into public.product_regulatory_outbox_events(organization_id,product_id,release_id,event_type,event_key,payload,correlation_id,occurred_at) select '${scope}'::uuid,'${input.productId}'::uuid,'${input.releaseId}'::uuid,'release.lifecycle_changed','m1103-fixture-' || gen_random_uuid()::text,'{}'::jsonb,gen_random_uuid(),clock_timestamp() from generate_series(1,${input.count}); commit;`,
                  encoding: "utf8",
                },
              );
              if (result.status !== 0)
                throw new Error("Scoped durable source fixture failed");
              respond(200, { inserted: input.count });
              return;
            }
            const input = configuration.parse(JSON.parse(raw));
            if (scope && scope !== input.organizationId)
              throw new Error("Fixture organization cannot change");
            const { data, error } = await supabase
              .from("organizations")
              .select("name")
              .eq("id", input.organizationId)
              .single();
            if (error || !data.name.startsWith("M11-03 "))
              throw new Error("Not a generated fixture organization");
            scope = input.organizationId;
            receiver.setKeys(input.keys);
            receiver.behavior = input.behavior;
            workerActive = input.workerActive;
            workerDelayMs = input.workerDelayMs;
            while (!workerActive && running)
              await new Promise((done) => setTimeout(done, 25));
            respond(200, { configured: true });
          } catch {
            respond(400, { message: "Invalid scoped fixture configuration" });
          }
        })();
      });
    });
    await new Promise<void>((done, reject) => {
      control.once("error", reject);
      control.listen(
        Number(process.env.M1103_CONTROL_PORT ?? 3340),
        "127.0.0.1",
        done,
      );
    });
    const timer = setInterval(() => {
      if (!workerActive || running) return;
      running = true;
      void (async () => {
        try {
          for (let index = 0; index < 40 && workerActive; index += 1) {
            if (!(await worker.tick(50))) break;
            if (workerDelayMs)
              await new Promise((done) => setTimeout(done, workerDelayMs));
          }
        } catch {
          tickFailure = true;
        } finally {
          running = false;
        }
      })();
    }, 100);
    const connectorTimer = setInterval(() => {
      if (!connectorScopes.length || connectorRunning) return;
      connectorRunning = true;
      void connectorWorker
        .runOnce()
        .catch(() => {
          tickFailure = true;
        })
        .finally(() => {
          connectorRunning = false;
        });
    }, 250);
    return {
      close: async () => {
        workerActive = false;
        clearInterval(timer);
        clearInterval(connectorTimer);
        while (running) await new Promise((done) => setTimeout(done, 25));
        while (connectorRunning)
          await new Promise((done) => setTimeout(done, 25));
        control.closeAllConnections();
        const results = await Promise.allSettled([
          new Promise<void>((done, reject) =>
            control.close((error) => (error ? reject(error) : done())),
          ),
          app.close(),
          receiver.close(),
        ]);
        const failures = results.filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failures.length)
          throw new AggregateError(
            failures.map((failure) => failure.reason as unknown),
            "Fixture shutdown failed",
          );
      },
    };
  } catch (error) {
    await Promise.allSettled([closeApp(), receiver.close()]);
    throw error;
  }
}

if (require.main === module) {
  void startM1103Fixture()
    .then((fixture) => {
      console.log("M11-03 isolated API and HTTPS receiver ready");
      for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.once(signal, () => {
          void fixture.close().then(() => process.exit(0));
        });
    })
    .catch(() => {
      console.error(
        "M11-03 fixture startup failed; check local environment and API build",
      );
      process.exitCode = 1;
    });
}
