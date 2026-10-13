import { LicensingRuntimeModule } from "../licensing-runtime.module";
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { SupabaseModule } from "../../supabase/supabase.module";
import { BoundedUploadController } from "./bounded-upload.controller";
import { BoundedUploadService } from "./bounded-upload.service";

/** Source adapters share one admission transport without granting source authority. */
@Global()
@Module({
  imports: [ConfigModule, SupabaseModule, LicensingRuntimeModule],
  controllers: [BoundedUploadController],
  providers: [BoundedUploadService],
  exports: [BoundedUploadService],
})
export class LicensingUploadsModule {}
