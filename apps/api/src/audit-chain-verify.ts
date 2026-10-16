import { createClient } from "@supabase/supabase-js";
import { parseAuditChainArguments } from "./audit/audit-chain-cli";
import { AuditChainVerifier } from "./audit/audit-chain-verifier";
import { SupabaseAuditChainAdapter } from "./audit/supabase-audit-chain.adapter";

export async function main(): Promise<void> {
  try {
    const request = parseAuditChainArguments(process.argv.slice(2));
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing configuration");
    const client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const result = await new AuditChainVerifier(
      new SupabaseAuditChainAdapter(client),
    ).verify(request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === "verified" ? 0 : 1;
  } catch {
    process.stderr.write(
      "Audit verification failed. Check explicit organization/range and operator configuration.\n",
    );
    process.exitCode = 1;
  }
}
if (require.main === module) void main();
