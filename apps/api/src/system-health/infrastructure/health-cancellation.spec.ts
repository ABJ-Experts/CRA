import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { RuntimeHealthAdapter } from "./runtime-health.adapter";
import { SupabaseHealthSourceAdapter } from "./supabase-health-source.adapter";
import { boundedProbe } from "../application/bounded-probe";

it.each(["storage", "source"] as const)(
  "aborts a real hung %s HTTP request",
  async (kind) => {
    let received!: () => void;
    let closed!: () => void;
    const requestReceived = new Promise<void>((resolve) => {
      received = resolve;
    });
    const connectionClosed = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const server = createServer((request) => {
      request.on("close", closed);
      received();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test listener unavailable");
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const client = createClient(url, "test-key", {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const runtime = new RuntimeHealthAdapter(
        {} as never,
        {} as never,
        {
          getOrThrow: (key: string) =>
            key === "SUPABASE_URL" ? url : "test-key",
        } as never,
      );
      const source = new SupabaseHealthSourceAdapter(
        { admin: () => client } as never,
        {} as never,
      );
      const result = boundedProbe(
        (signal) =>
          kind === "storage"
            ? runtime.storage(signal)
            : source
                .readSource("org", "actor", "licensing", signal)
                .then(() => true),
        100,
      );
      await requestReceived;
      await expect(result).resolves.toEqual({
        outcome: "unreachable",
        reason: "probe_timeout",
      });
      await connectionClosed;
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
