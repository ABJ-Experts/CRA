import { Test } from "@nestjs/testing";

import { SupabaseService } from "../supabase/supabase.service";
import { FrameworkUseCases } from "./application/framework-use-cases";
import { FrameworksController } from "./frameworks.controller";
import { FrameworksModule } from "./frameworks.module";

describe("FrameworksModule", () => {
  it("wires the controller to the scoped repository through its use case", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FrameworksModule],
    })
      .overrideProvider(SupabaseService)
      .useValue({ admin: jest.fn() })
      .compile();
    expect(moduleRef.get(FrameworksController)).toBeInstanceOf(
      FrameworksController,
    );
    expect(moduleRef.get(FrameworkUseCases)).toBeInstanceOf(FrameworkUseCases);
    await moduleRef.close();
  });
});
