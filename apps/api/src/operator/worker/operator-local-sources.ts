import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import {
  systemHealthVersionSchema,
  licenseCapabilitySchema,
} from "@repo/contracts";
import { SupabaseService } from "../../supabase/supabase.service";
import { SupabaseLicensingRepository } from "../../licensing/infrastructure/supabase-licensing.repository";
import { LocalLicenseVerifier } from "../../licensing/infrastructure/local-license-verifier";
import { LicensingService } from "../../licensing/application/licensing.service";
import { OperatorLocalMetadataEnricher } from "./operator-local-metadata";
/** Explicit worker-only sources; this factory is absent from the ingress graph. */
export function createLocalMetadataEnricher(
  env: NodeJS.ProcessEnv,
  credential: string,
): OperatorLocalMetadataEnricher {
  const build = env.SYSTEM_HEALTH_BUILD_MANIFEST
    ? systemHealthVersionSchema
        .pick({ version: true, commit: true, builtAt: true })
        .strict()
        .parse(JSON.parse(env.SYSTEM_HEALTH_BUILD_MANIFEST))
    : null;
  const expected = env.OPERATOR_EXPECTED_VERSION
    ? z.string().trim().min(1).max(80).parse(env.OPERATOR_EXPECTED_VERSION)
    : null;
  let licensing: LicensingService | null = null;
  if (env.LICENSING_TRUST_FILE) {
    const supabase = new SupabaseService(
      new ConfigService({ ...env, SUPABASE_SERVICE_ROLE_KEY: credential }),
    );
    let verifier: Promise<LocalLicenseVerifier> | undefined;
    licensing = new LicensingService(
      new SupabaseLicensingRepository(supabase),
      () =>
        (verifier ??= LocalLicenseVerifier.fromFile(env.LICENSING_TRUST_FILE!)),
      {
        instanceId: z.uuid().parse(env.LICENSING_INSTANCE_ID),
        policyRevision: z.coerce
          .number()
          .int()
          .min(1)
          .parse(env.LICENSING_POLICY_REVISION ?? 1),
        configuration: z
          .partialRecord(licenseCapabilitySchema, z.boolean())
          .parse(JSON.parse(env.LICENSING_LOCAL_FEATURES_JSON ?? "{}")),
      },
    );
  }
  return new OperatorLocalMetadataEnricher(licensing, build, expected);
}
