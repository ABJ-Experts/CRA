import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  RecoveryCheckFailure,
  type RecoveryCheckCode,
} from "../restore/isolated-backup-verifier";
import {
  emitRecoveryProbeDiagnostic,
  type RecoveryProbeObserver,
} from "./recovery-probe-diagnostics";
import { EvidenceAccessUseCases } from "../../../evidence/application/evidence-access-use-cases";
import { SupabaseEvidenceRepository } from "../../../evidence/infrastructure/supabase-evidence.repository";
import { SupabaseEvidenceStorageAdapter } from "../../../evidence/infrastructure/supabase-evidence-storage.adapter";
import type { SupabaseService } from "../../../supabase/supabase.service";

const uuid = z.string().uuid();
const internalEndpoint = z
  .string()
  .refine((value) =>
    /^http:\/\/cra-backup-probe-[0-9a-f-]{36}-(auth|rest|storage):(9999|3000|5000)$/.test(
      value,
    ),
  );
export const recoveryProbeRuntimeSchema = z
  .object({
    endpoints: z
      .object({
        auth: internalEndpoint,
        rest: internalEndpoint,
        storage: internalEndpoint,
      })
      .strict(),
    serviceKey: z.string().min(100).max(4096),
    identities: z.tuple([
      z
        .object({ email: z.string().email(), password: z.string().min(32) })
        .strict(),
      z
        .object({ email: z.string().email(), password: z.string().min(32) })
        .strict(),
    ]),
    fixture: z
      .object({
        organizationId: uuid,
        otherOrganizationId: uuid,
        productId: uuid,
        otherProductId: uuid,
        documentId: uuid,
        versionId: uuid,
      })
      .strict(),
    profileIds: z.tuple([uuid, uuid]).optional(),
  })
  .strict();
export type RecoveryProbeRuntimeConfiguration = z.output<
  typeof recoveryProbeRuntimeSchema
>;

/** A real HTTP client whose complete destination allowlist is the three target-only services. */
export function recoveryProbeFetch(
  endpoints: RecoveryProbeRuntimeConfiguration["endpoints"],
  transport: typeof fetch = fetch,
  observer?: RecoveryProbeObserver,
): typeof fetch {
  return async (input, init) => {
    const original = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (original.origin !== "http://recovery.invalid")
      throw new Error("recovery_probe_destination");
    const routes = [
      ["/auth/v1", endpoints.auth],
      ["/rest/v1", endpoints.rest],
      ["/storage/v1", endpoints.storage],
    ] as const;
    const route = routes.find(
      ([prefix]) =>
        original.pathname === prefix ||
        original.pathname.startsWith(prefix + "/"),
    );
    if (!route) throw new Error("recovery_probe_destination");
    const destination =
      route[1] + original.pathname.slice(route[0].length) + original.search;
    const request =
      input instanceof Request ? new Request(destination, input) : destination;
    try {
      const response = await transport(request, {
        ...init,
        redirect: "error",
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          AbortSignal.timeout(5000),
        ]),
      });
      emitRecoveryProbeDiagnostic(observer, {
        stage: "http",
        service:
          route[0] === "/auth/v1"
            ? "auth"
            : route[0] === "/rest/v1"
              ? "rest"
              : "storage",
        status: response.status,
      });
      return response;
    } catch (error) {
      emitRecoveryProbeDiagnostic(observer, {
        stage: "http",
        service:
          route[0] === "/auth/v1"
            ? "auth"
            : route[0] === "/rest/v1"
              ? "rest"
              : "storage",
        status: null,
      });
      throw error;
    }
  };
}
function client(
  config: RecoveryProbeRuntimeConfiguration,
  token = config.serviceKey,
  observer?: RecoveryProbeObserver,
) {
  return createClient("http://recovery.invalid", config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: recoveryProbeFetch(config.endpoints, fetch, observer),
      headers: { Authorization: `Bearer ${token}` },
    },
  });
}

export async function runRecoveryProbe(
  phase: string,
  path: string,
  observer?: RecoveryProbeObserver,
) {
  const config = recoveryProbeRuntimeSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  const admin = client(config, config.serviceKey, observer);
  if (phase === "create") {
    await awaitServices(config, observer);
    const authUserIds: string[] = [];
    for (const identity of config.identities) {
      const result = await admin.auth.admin.createUser({
        email: identity.email,
        password: identity.password,
        email_confirm: true,
      });
      if (result.error || !result.data.user)
        throw new Error("recovery_probe_identity");
      authUserIds.push(uuid.parse(result.data.user.id));
    }
    return { authUserIds };
  }
  if (phase !== "verify") throw new Error("recovery_probe_phase");
  return verifyRecoveryApplication(config, admin, (token) =>
    client(config, token, observer),
  );
}

export async function verifyRecoveryApplication(
  config: RecoveryProbeRuntimeConfiguration,
  admin: SupabaseClient,
  authenticatedClient: (token: string) => SupabaseClient,
) {
  let completedChecks: readonly RecoveryCheckCode[] = [];
  let failedCheck: RecoveryCheckCode = "authentication";
  try {
    if (!config.profileIds) throw new Error("recovery_probe_identity");
    const sessions = [];
    for (const identity of config.identities) {
      const loginClient = authenticatedClient(config.serviceKey);
      const loggedIn = await loginClient.auth.signInWithPassword(identity);
      if (loggedIn.error || !loggedIn.data.session)
        throw new Error("recovery_probe_authentication");
      const session = loggedIn.data.session;
      if (
        z
          .object({ alg: z.string() })
          .passthrough()
          .parse(
            JSON.parse(
              Buffer.from(
                session.access_token.split(".")[0]!,
                "base64url",
              ).toString(),
            ),
          ).alg !== "ES256"
      )
        throw new Error("recovery_probe_authentication");
      const verified = await loginClient.auth.getUser(session.access_token);
      if (verified.error || verified.data.user?.id !== session.user.id)
        throw new Error("recovery_probe_authentication");
      sessions.push(session);
    }
    completedChecks = ["authentication"];
    failedCheck = "tenant_isolation";
    const primary = authenticatedClient(sessions[0]!.access_token);
    const own = await primary
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", config.fixture.organizationId);
    const other = await primary
      .from("organization_members")
      .select("organization_id")
      .eq("organization_id", config.fixture.otherOrganizationId);
    if (
      own.error ||
      other.error ||
      !own.data?.length ||
      other.data?.length !== 0
    )
      throw new Error("recovery_probe_tenant_isolation");
    // Login clients are separate: the API-owned repository retains its service-role credential.
    const service = { admin: () => admin } as unknown as SupabaseService;
    const access = new EvidenceAccessUseCases(
      new SupabaseEvidenceRepository(service),
    );
    const selection = {
      organizationId: config.fixture.organizationId,
      actorId: config.profileIds[0],
      productId: config.fixture.productId,
      documentId: config.fixture.documentId,
      versionId: config.fixture.versionId,
      disposition: "attachment" as const,
      purpose: "Isolated recovery verification",
    };
    const crossTenant = await access.authorize({
      ...selection,
      actorId: config.profileIds[1],
    });
    if (crossTenant.outcome !== "forbidden")
      throw new Error("recovery_probe_tenant_isolation");
    completedChecks = [...completedChecks, "tenant_isolation"];
    failedCheck = "product_isolation";
    const crossProduct = await access.authorize({
      ...selection,
      productId: config.fixture.otherProductId,
    });
    if (crossProduct.outcome !== "forbidden")
      throw new Error("recovery_probe_product_isolation");
    completedChecks = [...completedChecks, "product_isolation"];
    failedCheck = "private_evidence_access";
    const grant = await access.authorize(selection);
    if (grant.outcome !== "ready")
      throw new Error("recovery_probe_evidence_access");
    const redeemed = await access.redeem({
      organizationId: selection.organizationId,
      actorId: selection.actorId,
      token: grant.token,
      rangeStart: null,
      rangeEnd: null,
    });
    if (redeemed.outcome !== "ready")
      throw new Error("recovery_probe_evidence_access");
    const storage = new SupabaseEvidenceStorageAdapter(service);
    const bytes = await storage.readVerified(redeemed.source);
    if (
      !bytes ||
      bytes.length !== redeemed.source.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !==
        redeemed.source.sha256
    )
      throw new Error("recovery_probe_evidence_integrity");
    return {
      checks: [
        "authentication",
        "tenant_isolation",
        "product_isolation",
        "private_evidence_access",
      ] as const,
    };
  } catch {
    throw new RecoveryCheckFailure(failedCheck, completedChecks);
  }
}

async function awaitServices(
  config: RecoveryProbeRuntimeConfiguration,
  observer?: RecoveryProbeObserver,
) {
  const deadline = AbortSignal.timeout(10000);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (deadline.aborted) throw new Error("recovery_probe_service_unavailable");
    const health = await Promise.allSettled([
      fetch(config.endpoints.auth + "/health", {
        redirect: "error",
        signal: AbortSignal.any([deadline, AbortSignal.timeout(1000)]),
      }),
      fetch(config.endpoints.rest + "/", {
        redirect: "error",
        signal: AbortSignal.any([deadline, AbortSignal.timeout(1000)]),
      }),
      fetch(config.endpoints.storage + "/status", {
        redirect: "error",
        signal: AbortSignal.any([deadline, AbortSignal.timeout(1000)]),
      }),
    ]);
    health.forEach((result, index) =>
      emitRecoveryProbeDiagnostic(observer, {
        stage: "health",
        service: (["auth", "rest", "storage"] as const)[index],
        status: result.status === "fulfilled" ? result.value.status : null,
      }),
    );
    if (
      health.every((result) => result.status === "fulfilled" && result.value.ok)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("recovery_probe_service_unavailable");
}
