import { apiErrorSchema } from "@repo/contracts/http";
import type { z } from "zod";

const GENERIC_API_ERROR = "Something went wrong. Please try again.";
const INVALID_RESPONSE_ERROR = "The server returned an unexpected response.";
const NETWORK_ERROR = "We could not reach the server.";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export class ApiClientError extends Error {
  constructor(
    readonly kind: "api" | "network" | "invalid_response",
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly fieldErrors?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface RequestJsonOptions<T> {
  readonly path: `/${string}`;
  readonly schema: z.ZodType<T>;
  readonly method?: HttpMethod;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly fetcher?: typeof fetch;
}

function assertLocalPath(path: string): asserts path is `/${string}` {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new ApiClientError(
      "invalid_response",
      "The request path must be a local absolute path.",
    );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchResponse(
  fetcher: typeof fetch,
  path: `/${string}`,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(path, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiClientError("network", NETWORK_ERROR);
  }
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiClientError("network", NETWORK_ERROR);
  }
}

function parsePayload(text: string): unknown {
  if (text === "") return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function requestJson<T>({
  path,
  schema,
  method = "GET",
  body,
  signal,
  fetcher = fetch,
}: RequestJsonOptions<T>): Promise<T> {
  assertLocalPath(path);

  const response = await fetchResponse(fetcher, path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = parsePayload(await readResponseText(response));

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    throw new ApiClientError(
      "api",
      parsed.success ? parsed.data.message : GENERIC_API_ERROR,
      response.status,
      parsed.success ? parsed.data.code : undefined,
      parsed.success ? parsed.data.fieldErrors : undefined,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_response",
      INVALID_RESPONSE_ERROR,
      response.status,
    );
  }

  return parsed.data;
}
