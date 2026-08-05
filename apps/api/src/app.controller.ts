import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  // Explicit @Inject so the class survives as a runtime value under esbuild/tsx
  // (which elides value imports used only in a type position).
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
