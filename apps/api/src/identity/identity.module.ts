import { Global, Module } from '@nestjs/common';
import {
  IDENTITY_PROVIDER,
  SupabaseIdentityAdapter,
} from './identity-provider';

// ADR-004: the IdentityProvider is injected via a token so the concrete adapter
// (Supabase for MVP/V1) can be swapped without touching consumers.
@Global()
@Module({
  providers: [
    {
      provide: IDENTITY_PROVIDER,
      useFactory: () => new SupabaseIdentityAdapter(),
    },
  ],
  exports: [IDENTITY_PROVIDER],
})
export class IdentityModule {}
