import { Module } from '@nestjs/common';
import { TriageController } from './triage.controller';

@Module({ controllers: [TriageController] })
export class TriageModule {}
