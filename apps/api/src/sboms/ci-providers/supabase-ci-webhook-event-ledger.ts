import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  CiWebhookEventLedger,
  CiWebhookLedgerInput,
} from "./ci-provider-webhook";

const ledgerResult = z
  .array(
    z.object({
      outcome: z.enum([
        "recorded",
        "replayed",
        "conflict",
        "not_found",
        "invalid_request",
      ]),
      event_id: z.uuid().nullable(),
    }),
  )
  .length(1);

type RpcClient = Readonly<{
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<
    Readonly<{
      data: unknown;
      error: unknown;
    }>
  >;
}>;

@Injectable()
export class SupabaseCiWebhookEventLedger implements CiWebhookEventLedger {
  constructor(private readonly supabase: SupabaseService) {}

  async record(orgId: string, input: CiWebhookLedgerInput) {
    const client = this.supabase.admin() as unknown as RpcClient;
    const result = await client.rpc("record_ci_provider_webhook_event_atomic", {
      p_organization_id: orgId,
      p_binding_id: input.bindingId,
      p_provider: input.provider,
      p_delivery_id: input.deliveryId,
      p_body_sha256: input.bodySha256,
      p_run_id: input.runId,
      p_run_attempt: input.runAttempt,
    });
    if (result.error) throw new Error("CI webhook event could not be recorded");
    const parsed = ledgerResult.parse(result.data)[0]!;
    return {
      outcome: parsed.outcome,
      ...(parsed.event_id ? { eventId: parsed.event_id } : {}),
    };
  }
}
