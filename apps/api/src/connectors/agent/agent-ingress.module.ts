import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { HttpBoundaryModule } from "../../common/http/http-boundary.module";
import { validateEnv } from "../../config/env.validation";
import { SupabaseModule } from "../../supabase/supabase.module";
import { SupabaseService } from "../../supabase/supabase.service";
import { AesGcmConnectorVault } from "../infrastructure/connector-vault";
import { AgentCertificateAuthority } from "./agent-certificate-authority";
import { AgentIngressController } from "./agent-ingress.controller";
import { AgentIngressUseCases } from "./agent-ingress.use-cases";
import { SupabaseAgentRepository } from "./supabase-agent.repository";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [".env.local", ".env"],
    }),
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),
    HttpBoundaryModule,
    SupabaseModule,
  ],
  controllers: [AgentIngressController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: AesGcmConnectorVault,
      useFactory: () =>
        new AesGcmConnectorVault(process.env.CONNECTOR_VAULT_KEYRING),
    },
    {
      provide: SupabaseAgentRepository,
      useFactory: (supabase: SupabaseService, vault: AesGcmConnectorVault) =>
        new SupabaseAgentRepository(supabase, vault),
      inject: [SupabaseService, AesGcmConnectorVault],
    },
    {
      provide: AgentCertificateAuthority,
      useFactory: () =>
        new AgentCertificateAuthority(
          process.env.AGENT_CA_CERT_PATH ?? "",
          process.env.AGENT_CA_KEY_PATH ?? "",
        ),
    },
    {
      provide: AgentIngressUseCases,
      useFactory: (
        repository: SupabaseAgentRepository,
        ca: AgentCertificateAuthority,
      ) => new AgentIngressUseCases(repository, ca),
      inject: [SupabaseAgentRepository, AgentCertificateAuthority],
    },
  ],
})
export class AgentIngressModule {}
