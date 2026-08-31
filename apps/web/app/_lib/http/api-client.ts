import { apiErrorSchema } from "@repo/contracts/shared/schemas";
import type { z } from "zod";

const GENERIC_API_ERROR = "Something went wrong. Please try again.";
const INVALID_REQUEST_ERROR = "The request contains invalid data.";
const INVALID_RESPONSE_ERROR = "The server returned an unexpected response.";
const NETWORK_ERROR = "We could not reach the server.";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export class ApiClientError extends Error {
  constructor(
    readonly kind: "api" | "network" | "invalid_request" | "invalid_response",
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly fieldErrors?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface RequestJsonOptions<
  TResponseSchema extends z.ZodTypeAny,
  TInputSchema extends z.ZodTypeAny = z.ZodNever,
> {
  readonly path: `/${string}`;
  readonly schema: TResponseSchema;
  readonly inputSchema?: TInputSchema;
  readonly method?: HttpMethod;
  readonly body?: z.input<TInputSchema>;
  readonly signal?: AbortSignal;
  readonly fetcher?: typeof fetch;
}

export interface RequestMultipartOptions<
  TResponseSchema extends z.ZodTypeAny,
  TFieldsSchema extends z.ZodTypeAny,
> {
  readonly path: `/${string}`;
  readonly schema: TResponseSchema;
  readonly fieldsSchema: TFieldsSchema;
  readonly fields: z.input<TFieldsSchema>;
  /**
   * Kept for existing single-file callers. New multipart commands may submit a
   * fixed, validated set of file parts through `files` instead.
   */
  readonly file?: Readonly<{ name: string; value: File | Blob }>;
  readonly files?: readonly Readonly<{
    name: string;
    value: File | Blob;
    /** Preserves a manifest-declared filename for Blob values. */
    filename?: string;
  }>[];
  readonly method?: Extract<HttpMethod, "POST" | "PATCH" | "PUT">;
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

async function parseResponse<TResponseSchema extends z.ZodTypeAny>(
  response: Response,
  schema: TResponseSchema,
): Promise<z.output<TResponseSchema>> {
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

function appendFormField(
  formData: FormData,
  name: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string" || value instanceof Blob) {
    formData.append(name, value);
    return;
  }
  formData.append(name, String(value));
}

function appendMultipartFile(
  formData: FormData,
  file: Readonly<{ name: string; value: File | Blob; filename?: string }>,
): void {
  if (file.filename === undefined) {
    formData.append(file.name, file.value);
    return;
  }
  formData.append(file.name, file.value, file.filename);
}

/** Stateful transport boundary; rendering code depends on this class via facades. */
export class ApiClient {
  async request<
    TResponseSchema extends z.ZodTypeAny,
    TInputSchema extends z.ZodTypeAny = z.ZodNever,
  >({
    path,
    schema,
    inputSchema,
    method = "GET",
    body,
    signal,
    fetcher = fetch,
  }: RequestJsonOptions<TResponseSchema, TInputSchema>): Promise<
    z.output<TResponseSchema>
  > {
    assertLocalPath(path);
    if (body !== undefined && !inputSchema) {
      throw new ApiClientError("invalid_request", INVALID_REQUEST_ERROR);
    }
    const parsedBody = inputSchema
      ? this.parseInput(inputSchema, body)
      : undefined;

    const response = await fetchResponse(fetcher, path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers:
        parsedBody === undefined
          ? undefined
          : { "content-type": "application/json" },
      body: parsedBody === undefined ? undefined : JSON.stringify(parsedBody),
    });

    return parseResponse(response, schema);
  }

  async requestMultipart<
    TResponseSchema extends z.ZodTypeAny,
    TFieldsSchema extends z.ZodTypeAny,
  >({
    path,
    schema,
    fieldsSchema,
    fields,
    file,
    files,
    method = "POST",
    signal,
    fetcher = fetch,
  }: RequestMultipartOptions<TResponseSchema, TFieldsSchema>): Promise<
    z.output<TResponseSchema>
  > {
    assertLocalPath(path);
    const parsedFields = this.parseInput(fieldsSchema, fields) as Record<
      string,
      unknown
    >;
    const multipartFiles = files ?? (file === undefined ? [] : [file]);
    if (
      multipartFiles.length === 0 ||
      (file !== undefined && files !== undefined)
    ) {
      throw new ApiClientError("invalid_request", INVALID_REQUEST_ERROR);
    }
    const formData = new FormData();
    for (const [key, value] of Object.entries(parsedFields)) {
      appendFormField(formData, key, value);
    }
    for (const file of multipartFiles) {
      appendMultipartFile(formData, file);
    }

    const response = await fetchResponse(fetcher, path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: undefined,
      body: formData,
    });

    return parseResponse(response, schema);
  }

  parseInput<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    value: unknown,
  ): z.output<TSchema> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new ApiClientError("invalid_request", INVALID_REQUEST_ERROR);
    }
    return parsed.data;
  }
}

export const apiClient = Object.freeze(new ApiClient());

/** Compatibility facade retained for existing feature callers. */
export function requestJson<
  TResponseSchema extends z.ZodTypeAny,
  TInputSchema extends z.ZodTypeAny = z.ZodNever,
>(
  options: RequestJsonOptions<TResponseSchema, TInputSchema>,
): Promise<z.output<TResponseSchema>> {
  return apiClient.request(options);
}

export function requestMultipart<
  TResponseSchema extends z.ZodTypeAny,
  TFieldsSchema extends z.ZodTypeAny,
>(
  options: RequestMultipartOptions<TResponseSchema, TFieldsSchema>,
): Promise<z.output<TResponseSchema>> {
  return apiClient.requestMultipart(options);
}
