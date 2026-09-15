import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { TechnicalFileDeclarationWorker } from "./technical-files/worker/technical-file-declaration-worker";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  try {
    await app.get(TechnicalFileDeclarationWorker).processOne();
  } finally {
    await app.close();
  }
}
void bootstrap();
