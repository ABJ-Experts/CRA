import { startSiemCollector } from "./fixtures/siem-collector";
import { SiemBrowserFixtureTransport } from "./fixtures/siem-browser-transport";
/** Local verification harness only. Never imported by production composition. */
import { loadSiemFixtureKeyring } from "./fixtures/siem-fixture-keyring";
import { writeFile } from "node:fs/promises";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module";
import { SiemVault } from "../src/audit/siem/infrastructure/siem-vault";
import { AesGcmConnectorVault } from "../src/connectors/infrastructure/connector-vault";
import { API_PREFIX } from "../src/auth/cookies.util";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { NodeSiemTransport } from "../src/audit/siem/infrastructure/node-siem-transport";
import { SupabaseSiemRepository } from "../src/audit/siem/infrastructure/supabase-siem.repository";
import { SiemWorker } from "../src/audit/siem/worker/siem-worker";
import type { SiemTransportPort } from "../src/audit/siem/application/siem-transport.port";
export async function runBrowserHarness(
  transport: SiemTransportPort,
  register?: (server: import("express").Express) => void,
) {
  const keyring = await loadSiemFixtureKeyring(
    "/tmp/m13-05-browser-keyring.json",
  );
  const vault = new SiemVault(new AesGcmConnectorVault(keyring));
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(NodeSiemTransport)
    .useValue(transport)
    .overrideProvider(SiemVault)
    .useValue(vault)
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix(API_PREFIX);
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  register?.(app.getHttpAdapter().getInstance() as import("express").Express);
  await app.listen(3334, "127.0.0.1");
  const worker = new SiemWorker(
    app.get(SupabaseSiemRepository),
    transport,
    vault,
  );
  let running = false;
  const interval = setInterval(() => {
    if (running) return;
    running = true;
    void worker
      .runOnce()
      .catch(() => {
        process.stderr.write("SIEM fixture worker unavailable\n");
      })
      .finally(() => {
        running = false;
      });
  }, 1000);
  const close = async () => {
    clearInterval(interval);
    await app.close();
  };
  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
  return { app, close };
}

if (require.main === module)
  void (async () => {
    const collector = await startSiemCollector();
    await writeFile(
      "/tmp/m13-05-browser-credential.json",
      JSON.stringify(collector.credential),
      { mode: 0o600 },
    );
    await runBrowserHarness(
      new SiemBrowserFixtureTransport(collector),
      (express) => {
        express.get("/__siem-fixture/events", (_request, response) =>
          response.json({
            messages: collector.received.map((bytes) => bytes.toString("utf8")),
          }),
        );
        express.post("/__siem-fixture/status/:status", (request, response) => {
          const status = Number(request.params.status);
          if (![202, 429, 503].includes(status)) {
            response.status(400).end();
            return;
          }
          collector.setResponse(status, status === 429 ? "1" : undefined);
          response.json({ ok: true });
        });
      },
    );
    process.once("SIGINT", () => {
      void collector.close();
    });
    process.once("SIGTERM", () => {
      void collector.close();
    });
    process.stdout.write("CRA SIEM fixture API ready on 127.0.0.1:3334\n");
  })();
