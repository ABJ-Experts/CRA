import { Module } from "@nestjs/common";
import { LicensingRuntimeModule } from "./licensing-runtime.module";
import { LicensingUploadsModule } from "./uploads/licensing-uploads.module";
import { LicensingController } from "./licensing.controller";
@Module({
  imports: [LicensingRuntimeModule, LicensingUploadsModule],
  controllers: [LicensingController],
  exports: [LicensingRuntimeModule],
})
export class LicensingModule {}
