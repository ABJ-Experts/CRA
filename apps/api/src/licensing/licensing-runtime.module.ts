import { SourceLicenseAdmission } from "./infrastructure/source-license-admission";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { licenseCapabilitySchema } from "@repo/contracts/licensing/schemas";
import { z } from "zod";
import { LicensingStartup } from "./infrastructure/licensing-startup";
import { SupabaseModule } from "../supabase/supabase.module";
import { LicensingService } from "./application/licensing.service";
import { SupabaseLicensingRepository } from "./infrastructure/supabase-licensing.repository";
import {
  LocalLicenseVerifier,
  LicenseVerificationError,
} from "./infrastructure/local-license-verifier";
const LOCAL_LICENSE_VERIFIER = Symbol("LOCAL_LICENSE_VERIFIER");
type VerifierLoader = () => Promise<LocalLicenseVerifier>;

@Module({
  imports: [ConfigModule, SupabaseModule],
  providers: [
    SourceLicenseAdmission,
    SupabaseLicensingRepository,
    {
      provide: LOCAL_LICENSE_VERIFIER,
      useFactory: (config: ConfigService): VerifierLoader => {
        // Trust changes are explicit mounted-file changes followed by process restart.
        let verifier: Promise<LocalLicenseVerifier> | undefined;
        return () => {
          const path = config.get<string>("LICENSING_TRUST_FILE");
          if (!path)
            return Promise.reject(
              new LicenseVerificationError("trust_unavailable"),
            );
          return (verifier ??= LocalLicenseVerifier.fromFile(path));
        };
      },
      inject: [ConfigService],
    },
    {
      provide: LicensingService,
      useFactory: (
        repository: SupabaseLicensingRepository,
        config: ConfigService,
        verifier: VerifierLoader,
      ) => {
        return new LicensingService(repository, verifier, {
          instanceId: config.get<string>("LICENSING_INSTANCE_ID"),
          policyRevision: config.get<number>("LICENSING_POLICY_REVISION") ?? 1,
          configuration: z
            .partialRecord(licenseCapabilitySchema, z.boolean())
            .parse(
              JSON.parse(
                config.get<string>("LICENSING_LOCAL_FEATURES_JSON") ?? "{}",
              ),
            ),
        });
      },
      inject: [
        SupabaseLicensingRepository,
        ConfigService,
        LOCAL_LICENSE_VERIFIER,
      ],
    },
    {
      provide: LicensingStartup,
      useFactory: (
        repository: SupabaseLicensingRepository,
        service: LicensingService,
        verifier: VerifierLoader,
        config: ConfigService,
      ) =>
        new LicensingStartup(repository, service, verifier, {
          instanceId: config.get<string>("LICENSING_INSTANCE_ID"),
          trustFile: config.get<string>("LICENSING_TRUST_FILE"),
        }),
      inject: [
        SupabaseLicensingRepository,
        LicensingService,
        LOCAL_LICENSE_VERIFIER,
        ConfigService,
      ],
    },
  ],
  exports: [LicensingService, SourceLicenseAdmission],
})
export class LicensingRuntimeModule {}
