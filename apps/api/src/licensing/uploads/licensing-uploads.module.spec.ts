import {
  GLOBAL_MODULE_METADATA,
  MODULE_METADATA,
} from "@nestjs/common/constants";
import { ConfigModule } from "@nestjs/config";
import { LicensingRuntimeModule } from "../licensing-runtime.module";
import { SupabaseModule } from "../../supabase/supabase.module";
import { LicensingUploadsModule } from "./licensing-uploads.module";
import { BoundedUploadController } from "./bounded-upload.controller";
import { BoundedUploadService } from "./bounded-upload.service";

describe("bounded upload composition", () => {
  it("shares one admission service across source adapters without duplicating policy authority", () => {
    expect(
      Reflect.getMetadata(GLOBAL_MODULE_METADATA, LicensingUploadsModule),
    ).toBe(true);
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, LicensingUploadsModule),
    ).toEqual([ConfigModule, SupabaseModule, LicensingRuntimeModule]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, LicensingUploadsModule),
    ).toEqual([BoundedUploadController]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, LicensingUploadsModule),
    ).toEqual([BoundedUploadService]);
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, LicensingUploadsModule),
    ).toEqual([BoundedUploadService]);
  });
});
