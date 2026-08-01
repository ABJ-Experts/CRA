import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // 3000 is taken by apps/web and 3001 by apps/docs.
  await app.listen(process.env.PORT ?? 3333);
}
void bootstrap();
