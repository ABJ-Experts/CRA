import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentQueue } from "./queue.js";
import { credentialsPath, ensureQueueKey, loadAgentConfig, queuePath, readCredentials } from "./config.js";
import { enroll, rotate } from "./identity.js";
import { processSource, safeErrorCode } from "./runtime.js";
import { sendAgentFrame, type AgentCredentials, type TransportConfig } from "./transport.js";

function transportFor(config: ReturnType<typeof loadAgentConfig>): TransportConfig {
  return {
    ingressUrl: config.ingressUrl,
    serverCaPem: readFileSync(config.serverCaFile, "utf8"),
    timeoutMs: config.timeoutMs,
    ...(config.proxyUrl ? { proxyUrl: config.proxyUrl } : {}),
  };
}

export async function serve(config: ReturnType<typeof loadAgentConfig>, transport: TransportConfig, stop?: AbortSignal): Promise<void> {
  const queue = new AgentQueue({ path: queuePath(config), key: ensureQueueKey(config), maxBytes: config.maxQueueBytes, maxBatches: 1 });
  let running = true;
  const requestStop = () => { running = false; };
  process.once("SIGTERM", requestStop);
  process.once("SIGINT", requestStop);
  stop?.addEventListener("abort", requestStop, { once: true });
  let failures = 0;
  try {
    while (running && !stop?.aborted) {
      let credentials: AgentCredentials = readCredentials(config);
      let cycleError: ReturnType<typeof safeErrorCode> | null = null;
      try {
        if (Date.parse(credentials.expiresAt) - Date.now() <= 7 * 24 * 60 * 60 * 1000) credentials = await rotate(config, transport);
        const source = config.sources[0];
        if (!source) throw new Error("missing_source");
        await processSource(config, source, queue, credentials, async (frame) => {
          const response = await sendAgentFrame(transport, credentials, frame);
          if (response.kind !== "batch") throw new Error("ack_mismatch");
          return response;
        });
        failures = 0;
      } catch (error) {
        cycleError = safeErrorCode(error);
        failures = Math.min(failures + 1, 6);
        process.stderr.write(JSON.stringify({ event: "agent_cycle_failed", code: cycleError }) + "\n");
      }
      try {
        const backlog = queue.backlog();
        await sendAgentFrame(transport, credentials, {
          version: 1, kind: "heartbeat",
          organizationId: credentials.organizationId,
          connectorId: credentials.connectorId,
          agentId: credentials.agentId,
          agentVersion: "0.1.0",
          capabilities: [config.sources[0]?.type === "https" ? "https_read" : "canonical_file"],
          backlogCount: backlog.count,
          backlogBytes: backlog.bytes,
          safeErrorCode: cycleError,
        });
      } catch (error) {
        failures = Math.min(failures + 1, 6);
        process.stderr.write(JSON.stringify({ event: "agent_contact_failed", code: safeErrorCode(error) }) + "\n");
      }
      const delay = failures === 0 ? config.pollIntervalMs : Math.min(60_000, 1000 * 2 ** failures);
      if (running) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  } finally {
    process.off("SIGTERM", requestStop);
    process.off("SIGINT", requestStop);
    stop?.removeEventListener("abort", requestStop);
    queue.close();
  }
}

export async function runAgentCli(args: readonly string[]): Promise<void> {
  const [command, configFlag, configPath] = args;
  if (!command || !["enroll", "rotate", "serve", "status"].includes(command) || configFlag !== "--config" || !configPath) throw new Error("usage: agent enroll|rotate|serve|status --config /absolute/config.json");
  const config = loadAgentConfig(configPath);
  if (command === "status") {
    const queue = new AgentQueue({ path: queuePath(config), key: ensureQueueKey(config), maxBytes: config.maxQueueBytes, maxBatches: 1 });
    try { process.stdout.write(JSON.stringify({ credentialsPresent: existsSync(credentialsPath(config)), backlog: queue.backlog() }) + "\n"); }
    finally { queue.close(); }
    return;
  }
  const transport = transportFor(config);
  if (command === "enroll") {
    const credentials = await enroll(config, transport);
    process.stdout.write(JSON.stringify({ enrolled: true, agentId: credentials.agentId }) + "\n");
  } else if (command === "rotate") {
    const credentials = await rotate(config, transport);
    process.stdout.write(JSON.stringify({ rotated: true, agentId: credentials.agentId }) + "\n");
  } else await serve(config, transport);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runAgentCli(process.argv.slice(2)).catch((error: unknown) => {
    const code = error instanceof Error && error.message.startsWith("usage:") ? error.message : safeErrorCode(error);
    process.stderr.write(JSON.stringify({ event: "agent_failed", code }) + "\n");
    process.exitCode = 1;
  });
}
