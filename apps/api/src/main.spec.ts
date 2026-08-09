import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import helmet from "helmet";

jest.mock("@nestjs/core", () => ({
  NestFactory: { create: jest.fn() },
}));
jest.mock("cookie-parser", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("helmet", () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe("API bootstrap", () => {
  it("applies the security and transport contract before listening", async () => {
    const cookieMiddleware = jest.fn();
    const helmetMiddleware = jest.fn();
    jest.mocked(cookieParser).mockReturnValue(cookieMiddleware);
    jest.mocked(helmet).mockReturnValue(helmetMiddleware);

    const getOrThrow = jest.fn((key: string) => {
      const values: Record<string, string | number> = {
        WEB_ORIGIN: "https://web.cra.test",
        PORT: 3333,
      };
      return values[key];
    });
    const app = {
      get: jest.fn().mockReturnValue({ getOrThrow }),
      setGlobalPrefix: jest.fn(),
      set: jest.fn(),
      use: jest.fn(),
      enableCors: jest.fn(),
      useGlobalFilters: jest.fn(),
      enableShutdownHooks: jest.fn(),
      listen: jest.fn().mockResolvedValue(undefined),
    };
    const create = jest
      .spyOn(NestFactory, "create")
      .mockResolvedValue(app as never);
    const loggerLog = jest.spyOn(Logger.prototype, "log").mockImplementation();

    jest.requireActual<Record<string, never>>("./main");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(create).toHaveBeenCalledWith(expect.any(Function), {
      bufferLogs: false,
    });
    expect(app.setGlobalPrefix).toHaveBeenCalledWith("api/v1");
    expect(app.set).toHaveBeenCalledWith("trust proxy", 1);
    expect(cookieParser).toHaveBeenCalledWith();
    expect(helmet).toHaveBeenCalledWith({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    });
    expect(app.use).toHaveBeenNthCalledWith(1, cookieMiddleware);
    expect(app.use).toHaveBeenNthCalledWith(2, helmetMiddleware);
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ["https://web.cra.test"],
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    });
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1);
    expect(app.enableShutdownHooks).toHaveBeenCalledWith();
    expect(getOrThrow).toHaveBeenNthCalledWith(1, "WEB_ORIGIN");
    expect(getOrThrow).toHaveBeenNthCalledWith(2, "PORT");
    expect(app.listen).toHaveBeenCalledWith(3333);
    expect(loggerLog).toHaveBeenCalledWith(
      "API listening on http://localhost:3333/api/v1",
    );
    expect(loggerLog).toHaveBeenCalledWith("CORS origin: https://web.cra.test");
  });
});
