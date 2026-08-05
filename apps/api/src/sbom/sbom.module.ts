import { Module } from '@nestjs/common';
import { SbomController } from './sbom.controller';

@Module({ controllers: [SbomController] })
export class SbomModule {}
