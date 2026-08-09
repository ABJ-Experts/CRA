import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { ZodResponseInterceptor } from "./zod-response.interceptor";

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: ZodResponseInterceptor }],
})
export class HttpBoundaryModule {}
