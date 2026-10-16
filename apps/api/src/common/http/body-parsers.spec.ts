import { Controller, Module, Post, Put, Req } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request } from "express";
import request from "supertest";
import { configureApiBodyParsers } from "./body-parsers";

@Controller()
class ParserFixtureController {
  @Post("json")
  json(@Req() req: Request & { rawBody?: Buffer }) {
    return { value: req.body as unknown, raw: req.rawBody?.toString() };
  }
  @Put("licensing/uploads/:operationId/:token")
  async upload(@Req() req: Request) {
    const chunks: Buffer[] = [];
    for await (const chunk of req)
      chunks.push(Buffer.from(chunk as Uint8Array));
    return { raw: Buffer.concat(chunks).toString() };
  }
}
@Module({ controllers: [ParserFixtureController] })
class ParserFixtureModule {}

describe("API body parsing boundary", () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(
      ParserFixtureModule,
      {
        rawBody: true,
        bodyParser: false,
        logger: false,
      },
    );
    app.setGlobalPrefix("api/v1");
    configureApiBodyParsers(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it("keeps exact signed JSON bytes while parsing ordinary API input", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/json")
      .set("Content-Type", "application/json")
      .send('{"ok":true}')
      .expect(201)
      .expect({ value: { ok: true }, raw: '{"ok":true}' });
  });
  it("does not consume JSON-shaped bounded upload bytes before the upload stream", async () => {
    await request(app.getHttpServer())
      .put("/api/v1/licensing/uploads/id/token")
      .set("Content-Type", "application/json")
      .send('{"source":true}')
      .expect(200)
      .expect({ raw: '{"source":true}' });
  });
  it("does not consume form-shaped bounded upload bytes", async () => {
    await request(app.getHttpServer())
      .put("/api/v1/licensing/uploads/id/token")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a=b")
      .expect(200)
      .expect({ raw: "a=b" });
  });
});
