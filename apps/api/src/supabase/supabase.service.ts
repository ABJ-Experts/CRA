import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Typed against the generated schema.
 *
 * `apps/infrastructure`'s `db:types` script writes `database.types.ts` into this
 * directory as well as its own, so the generic below always matches the applied
 * migrations. Regenerate with `pnpm --filter infrastructure run db:types`.
 *
 * Without the generic every query result is `any` and `.rpc()` refuses its
 * argument object outright — which is how a codebase ends up with an unsafe
 * cast at each call site and no real type safety anywhere.
 */
export type CraSupabaseClient = ReturnType<typeof createClient<Database>>;

/**
 * The three Supabase clients, kept deliberately distinct so that reaching for
 * the dangerous one is a visible act rather than a default.
 *
 *   admin()          service_role. BYPASSES RLS. Every query made with it MUST
 *                    carry its own organization filter — see the repository
 *                    note below.
 *   anon()           anon key, no session. Used for sign-up / sign-in, where
 *                    there is no user yet.
 *   asUser(token)    anon key plus the caller's bearer token, so RLS and
 *                    auth.uid() apply. Required for anything GoTrue insists a
 *                    user does for themselves — MFA enrolment in particular
 *                    cannot be performed by service_role on a user's behalf.
 *
 * THE BOUNDARY, STATED ONCE:
 *   Because the API uses service_role, RLS is NOT what keeps one organization's
 *   data away from another. A forgotten `.eq('organization_id', ...)` is a
 *   cross-tenant leak that no policy will catch. That is why every read goes
 *   through a repository helper that takes orgId as a required first argument.
 */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly url: string;
  private readonly anonKey: string;
  private readonly serviceKey: string;

  private adminClient?: CraSupabaseClient;

  constructor(private readonly config: ConfigService) {
    this.url = this.config.getOrThrow<string>("SUPABASE_URL");
    this.anonKey = this.config.getOrThrow<string>("SUPABASE_ANON_KEY");
    this.serviceKey = this.config.getOrThrow<string>(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  /**
   * Long-lived singleton. `persistSession` and `autoRefreshToken` are both off:
   * this is a server, there is no browser storage to persist into, and a
   * background refresh timer on a service-role key is pointless work that also
   * keeps the process alive during tests.
   */
  admin(): CraSupabaseClient {
    this.adminClient ??= createClient<Database>(this.url, this.serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return this.adminClient;
  }

  /**
   * A FRESH client every call, never a singleton.
   *
   * supabase-js stores the session on the client instance, so a shared anon
   * client would let one request's sign-in leak into the next request's calls —
   * a cross-user session bleed under concurrency that is close to impossible to
   * reproduce after the fact.
   */
  anon(): CraSupabaseClient {
    return createClient<Database>(this.url, this.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  /** Per-request client bound to one user's access token. Also never cached. */
  asUser(accessToken: string): CraSupabaseClient {
    return createClient<Database>(this.url, this.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  /** Cheap liveness probe used by GET /api/v1/health. */
  async ping(): Promise<boolean> {
    const { error } = await this.admin()
      .from("organizations")
      .select("id")
      .limit(1);

    if (error) {
      this.logger.error(`Supabase ping failed: ${error.message}`);
      return false;
    }
    return true;
  }
}
