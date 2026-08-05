import { Module } from '@nestjs/common';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';

// STORAGE_PROVIDER is supplied by the @Global() StorageModule (ADR-013) rather
// than bound here, so evidence documents and SBOM originals share one object
// store instead of each module holding its own.
@Module({
  controllers: [EvidenceController],
  providers: [EvidenceService],
  exports: [EvidenceService],
})
export class EvidenceModule {}
