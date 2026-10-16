import type { IncomingMessage } from "node:http";
import type { NestExpressApplication } from "@nestjs/platform-express";

function accepts(request: IncomingMessage, mediaType: string): boolean {
  // Upload grants authorize exact raw bytes, including JSON and CSV sources.
  return (
    !request.url?.startsWith("/api/v1/licensing/uploads/") &&
    request.headers["content-type"]?.split(";", 1)[0]?.trim() === mediaType
  );
}

export function configureApiBodyParsers(app: NestExpressApplication): void {
  app.useBodyParser("json", {
    limit: "2200kb",
    type: (request: IncomingMessage) => accepts(request, "application/json"),
  });
  app.useBodyParser("urlencoded", {
    extended: true,
    type: (request: IncomingMessage) =>
      accepts(request, "application/x-www-form-urlencoded"),
  });
}
