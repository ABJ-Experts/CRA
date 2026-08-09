import { Global, Module } from "@nestjs/common";

import { SupabaseService } from "./supabase.service";

/**
 * Global so feature modules do not each have to import it. The service holds no
 * per-request state — the only cached client is the service-role singleton, and
 * the anon/user clients are constructed fresh per call for exactly that reason.
 */
@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
