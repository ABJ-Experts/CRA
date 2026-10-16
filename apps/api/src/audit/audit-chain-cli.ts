import { auditChainRequestSchema } from "@repo/contracts/audit/schemas";
import type { AuditChainRequest } from "@repo/contracts/audit/types";

/** Accept only explicit flags: accidental environment/tenant defaults are forbidden. */
export function parseAuditChainArguments(args: string[]): AuditChainRequest {
  const fields: Record<string, unknown> = {};
  const names: Record<string, string> = {
    "--organization": "organizationId",
    "--from": "fromSequence",
    "--to": "toSequence",
    "--page-size": "pageSize",
    "--max-events": "maxEvents",
  };
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const name = flag === undefined ? undefined : names[flag];
    const value = args[index + 1];
    if (
      !name ||
      value === undefined ||
      value.startsWith("--") ||
      name in fields
    )
      throw new Error("Invalid audit verifier arguments");
    fields[name] =
      name === "pageSize" || name === "maxEvents" ? Number(value) : value;
  }
  return auditChainRequestSchema.parse(fields);
}
