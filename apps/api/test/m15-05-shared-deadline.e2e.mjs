/* Read-only PostgreSQL 17 capability test. No table locks, DDL, or data changes. */
import { execFile, spawn } from "node:child_process";
import { performance as monotonicClock } from "node:perf_hooks";
import { promisify } from "node:util";
const exec = promisify(execFile);
const container = process.env.BACKUP_TEST_DB_CONTAINER || "supabase_db_cra";
const database = process.env.BACKUP_TEST_DATABASE || "postgres";
const user = process.env.BACKUP_TEST_DATABASE_USER || "postgres";
for (const value of [container, database, user]) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value))
    throw Error("unsafe_test_configuration");
}
async function sql(query, keepOpen = false) {
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-XAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      user,
      "-d",
      database,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let monitor = null;
  let checking = false;
  let backendGone = false;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    const pid = stdout.match(/FENCE_READY:(\d+)/)?.[1];
    if (keepOpen && pid && !monitor)
      monitor = setInterval(() => {
        if (checking) return;
        checking = true;
        void sql(`SELECT count(*) FROM pg_stat_activity WHERE pid=${pid}`)
          .then((result) => {
            if (result.stdout === "0") {
              backendGone = true;
              clearInterval(monitor);
              child.stdin.end("SELECT 1;\n");
            }
          })
          .catch(() => child.kill("SIGKILL"))
          .finally(() => {
            checking = false;
          });
      }, 50);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdin.write(`${query}\n`);
  if (!keepOpen) child.stdin.end();
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 5000);
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  clearTimeout(watchdog);
  if (monitor) clearInterval(monitor);
  return { code, stdout: stdout.trim(), stderr, backendGone };
}
(async () => {
  const version = (await sql("SHOW server_version")).stdout;
  if (!/^17\.6(?:\s|$)/.test(version)) throw Error("unsupported_test_runtime");
  const capStarted = monotonicClock.now();
  const cap = await sql(
    "SET transaction_timeout='1s';\nBEGIN READ ONLY;\nSELECT pg_sleep(10);",
  );
  const capElapsedMs = Math.round(monotonicClock.now() - capStarted);
  if (
    cap.code === 0 ||
    !cap.stderr.includes("transaction timeout") ||
    capElapsedMs > 2000
  )
    throw Error("transaction_cap_not_enforced");
  const started = monotonicClock.now();
  const deadline = (
    await sql(
      "SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
    )
  ).stdout;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(deadline))
    throw Error("invalid_database_clock");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const body = `SET transaction_timeout='120s';\nBEGIN READ ONLY;\nDO $backup_deadline$ DECLARE remaining_ms integer:=floor(extract(epoch FROM ('${deadline}'::timestamptz-clock_timestamp()))*1000); BEGIN IF remaining_ms<=0 THEN RAISE EXCEPTION 'backup_fence_expired'; END IF; PERFORM set_config('idle_in_transaction_session_timeout',least(remaining_ms,120000)::text||'ms',true); PERFORM set_config('statement_timeout',least(remaining_ms,120000)::text||'ms',true); END $backup_deadline$;\nSELECT 'FENCE_READY:'||pg_backend_pid();`;
  const timed = await sql(body, true);
  const elapsedMs = Math.round(monotonicClock.now() - started);
  const expired = await sql(body);
  if (
    !timed.backendGone ||
    timed.code === 0 ||
    !timed.stderr.includes("idle-in-transaction timeout") ||
    elapsedMs > 3000 ||
    expired.code === 0 ||
    !expired.stderr.includes("backup_fence_expired")
  )
    throw Error("shared_deadline_not_enforced");
  // Verify the database remains reachable after only the private test session was terminated.
  await exec("docker", [
    "exec",
    container,
    "psql",
    "-XAt",
    "-U",
    user,
    "-d",
    database,
    "-c",
    "SELECT 1",
  ]);
  console.log(
    JSON.stringify({
      postgresVersion: version,
      readOnly: true,
      tableLocks: false,
      transactionCapMs: 1000,
      transactionCapElapsedMs: capElapsedMs,
      globalDeadlineMs: 2000,
      delayedConnectionMs: 500,
      elapsedMs,
      lateTransactionTerminated: true,
      expiredStartRejected: true,
      databaseReachable: true,
    }),
  );
})().catch(() => {
  console.error("shared_deadline_verification_failed");
  process.exitCode = 1;
});
