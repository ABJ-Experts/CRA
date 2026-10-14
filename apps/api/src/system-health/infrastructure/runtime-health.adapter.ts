import type { ConfigService } from "@nestjs/config";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { AuditService } from "../../audit/audit.service";
import type { SystemHealthRuntimePort } from "../application/system-health.port";
/** Storage GET is reachability only; no byte-integrity or free-capacity assertion. */
export class RuntimeHealthAdapter implements SystemHealthRuntimePort {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  database(signal: AbortSignal) {
    return this.supabase.ping(signal);
  }
  audit(signal: AbortSignal) {
    return this.auditService.isReady(signal);
  }
  async storage(signal: AbortSignal): Promise<boolean> {
    const key = this.config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY");
    const response = await this.fetcher(
      `${this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "")}/storage/v1/bucket`,
      {
        method: "GET",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        redirect: "error",
        signal,
      },
    );
    await response.body?.cancel();
    return response.ok;
  }
}
