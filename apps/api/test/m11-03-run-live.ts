import "./m11-03-environment";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { startM1103Fixture } from "./m11-03-fixture";

/** pnpm --filter api exec ts-node --transpile-only test/m11-03-run-live.ts */
async function run() {
  process.env.M1103_CONTROL_TOKEN = randomBytes(32).toString("hex");
  const checkpointDirectory = await mkdtemp(
    join(tmpdir(), "cra-m1103-checkpoint-"),
  );
  process.env.M1103_CHECKPOINT_DIRECTORY = checkpointDirectory;
  if (process.env.M1103_REPEAT_AFTER_MCP === "true")
    await writeFile(
      join(checkpointDirectory, "mcp-done"),
      "Prior complete journey already inspected by coordinated MCP operator.\n",
    );
  const fixture = await startM1103Fixture();
  const webDirectory = resolve("../web");
  const env = {
    ...process.env,
    API_ORIGIN: "http://localhost:3339",
    NEXT_PUBLIC_API_ORIGIN: "http://localhost:3339",
    NEXT_PUBLIC_ENABLE_MOCKS: "false",
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    E2E_API_ORIGIN: "http://localhost:3339",
    E2E_WEB_ORIGIN: "http://localhost:3011",
    E2E_OWNER_EMAIL: process.env.E2E_OWNER_EMAIL ?? "owner@cra.test",
    E2E_OWNER_PASSWORD: process.env.E2E_OWNER_PASSWORD ?? "Password123",
  };
  const code = `process.execArgv=[];const http=require('node:http'); const configPath=require.resolve('next/dist/server/config');const loader=require(configPath);require.cache[configPath].exports={...loader,__esModule:true,default:async(...args)=>({...await loader.default(...args),distDir:'node_modules/.cache/cra-m1103-next/dev'})};const next=require('next'); (async()=>{const app=next({dev:true,dir:process.cwd(),hostname:'localhost',port:3011});await app.prepare();const server=http.createServer(app.getRequestHandler());server.listen(3011,'127.0.0.1',()=>console.log('M11-03 isolated Next ready')); for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{server.close();void app.close().then(()=>process.exit(0))});})().catch(error=>{console.error('M11-03 isolated Next failed:',error.message);process.exitCode=1});`;
  const web = spawn(process.execPath, ["-e", code], {
    cwd: webDirectory,
    env,
    stdio: "inherit",
  });
  let tests: ChildProcess | null = null;
  let closing = false;
  const close = async (status = 0) => {
    if (closing) return;
    closing = true;
    tests?.kill("SIGTERM");
    web.kill("SIGTERM");
    await fixture.close();
    await rm(checkpointDirectory, { recursive: true, force: true });
    process.exit(status);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void close();
    });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (web.exitCode !== null) break;
    try {
      if ((await fetch("http://localhost:3011/api/v1/health")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Dev server is still preparing. */
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  if (!ready) {
    await close(1);
  }
  console.log(
    "M11-03 test services ready: API http://localhost:3339, web http://localhost:3011",
  );
  console.log(`M11-03 MCP checkpoint directory: ${checkpointDirectory}`);
  tests = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      process.env.M1103_REGRESSIONS_ONLY === "true"
        ? "e2e/m11-03-regressions.spec.ts"
        : "e2e/m11-03-outbound-webhooks.spec.ts",
      "--project=chromium",
      "--workers=1",
      process.env.M1103_REGRESSIONS_ONLY === "true"
        ? "--output=test-results/m11-03-regressions-repeat"
        : "--output=test-results/m11-03",
    ],
    { cwd: webDirectory, env, stdio: "inherit" },
  );
  tests.once("exit", (status) => {
    console.log(
      `M11-03 Playwright exit ${status ?? "signal"}; isolated services remain available until SIGINT/SIGTERM`,
    );
    if (
      status === 0 &&
      process.env.M1103_REGRESSIONS === "true" &&
      process.env.M1103_REGRESSIONS_ONLY !== "true"
    ) {
      tests = spawn(
        "pnpm",
        [
          "exec",
          "playwright",
          "test",
          "e2e/m11-03-regressions.spec.ts",
          "--project=chromium",
          "--workers=1",
          "--output=test-results/m11-03-regressions",
        ],
        { cwd: webDirectory, env, stdio: "inherit" },
      );
      tests.once("exit", (regressionStatus) =>
        console.log(
          `M11-03 existing browser regression exit ${regressionStatus ?? "signal"}; services remain available`,
        ),
      );
    }
  });
}

void run().catch(() => {
  console.error(
    "M11-03 orchestration failed; inspect local fixture environment",
  );
  process.exitCode = 1;
});
