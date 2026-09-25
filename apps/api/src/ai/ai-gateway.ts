import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { supplierDocumentModelOutputSchema } from "@repo/contracts/supplier-evidence/schemas";
import { z } from "zod";

import {
  SUPPLIER_FIELDS_PROMPT_VERSION,
  SUPPLIER_FIELDS_SYSTEM_PROMPT,
} from "./supplier-fields.prompt";

const inputSchema = z
  .object({
    organizationId: z.uuid(),
    versionId: z.uuid(),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    pages: z
      .array(
        z
          .object({
            page: z.number().int().positive(),
            text: z.string().min(1).max(20_000),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    policy: z
      .object({
        enabled: z.boolean(),
        mode: z.literal("local-only"),
        remainingTokens: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .refine(
    ({ pages }) =>
      pages.reduce((total, page) => total + page.text.length, 0) <= 80_000,
    "document text exceeds the extraction limit",
  )
  .refine(
    ({ pages }) =>
      new Set(pages.map((page) => page.page)).size === pages.length,
    "page numbers must be unique",
  );

const providerResponseSchema = z
  .object({
    model: z.string(),
    message: z.object({ role: z.literal("assistant"), content: z.string() }),
    done_reason: z.string().optional(),
    prompt_eval_count: z.number().int().nonnegative(),
    eval_count: z.number().int().nonnegative(),
  })
  .passthrough();

export type AiExtractionInput = z.input<typeof inputSchema>;
export type AiExtractionCandidate = z.output<
  typeof supplierDocumentModelOutputSchema
>["candidates"][number];

export type AiExtractionResult = {
  promptVersion: string;
  model: string;
  candidates: AiExtractionCandidate[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type AiGatewayErrorCode =
  | "invalid_input"
  | "policy_denied"
  | "budget_exhausted"
  | "timeout"
  | "unavailable"
  | "provider_failure"
  | "refusal"
  | "malformed_output";

export class AiGatewayError extends Error {
  constructor(
    readonly code: AiGatewayErrorCode,
    readonly retryable = false,
  ) {
    super(`AI extraction ${code.replaceAll("_", " ")}`);
    this.name = "AiGatewayError";
  }
}

const MAX_OUTPUT_TOKENS = 2048;
const MAX_RESPONSE_BYTES = 512_000;

@Injectable()
export class AiGateway {
  constructor(
    private readonly config: ConfigService,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async extractSupplierFields(
    raw: AiExtractionInput,
  ): Promise<AiExtractionResult> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) throw new AiGatewayError("invalid_input");
    const input = parsed.data;
    if (!input.policy.enabled) throw new AiGatewayError("policy_denied");

    const endpoint = this.config.get<string>("AI_OLLAMA_URL");
    const model = this.config.get<string>("AI_OLLAMA_MODEL");
    if (!endpoint || !model) throw new AiGatewayError("unavailable");
    // This guard also protects direct construction in tests and worker contexts.
    const url = new URL(endpoint);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    )
      throw new AiGatewayError("unavailable");

    const pages = input.pages.map(({ page, text }) => ({ page, text }));
    const estimatedInputTokens = Math.ceil(JSON.stringify(pages).length / 4);
    const started = Date.now();
    let remainingTokens = input.policy.remainingTokens;
    let inputTokens = 0;
    let outputTokens = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const maxOutputTokens = Math.min(
        MAX_OUTPUT_TOKENS,
        remainingTokens - estimatedInputTokens,
      );
      if (maxOutputTokens < 1) throw new AiGatewayError("budget_exhausted");
      const requestBody = JSON.stringify({
        model,
        stream: false,
        format: z.toJSONSchema(supplierDocumentModelOutputSchema, {
          io: "input",
        }),
        options: { num_predict: maxOutputTokens, temperature: 0 },
        messages: [
          { role: "system", content: SUPPLIER_FIELDS_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ pages }) },
        ],
      });
      try {
        const response = await this.request(
          `${url.origin}/api/chat`,
          requestBody,
        );
        inputTokens += response.prompt_eval_count;
        outputTokens += response.eval_count;
        remainingTokens -= response.prompt_eval_count + response.eval_count;
        if (remainingTokens < 0) throw new AiGatewayError("budget_exhausted");
        const candidates = this.parseCandidates(response, pages, model);
        return {
          promptVersion: SUPPLIER_FIELDS_PROMPT_VERSION,
          model,
          candidates,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - started,
        };
      } catch (error) {
        if (
          !(error instanceof AiGatewayError) ||
          !error.retryable ||
          attempt === 1
        )
          throw error;
      }
    }
    throw new AiGatewayError("provider_failure");
  }

  private parseCandidates(
    response: z.output<typeof providerResponseSchema>,
    pages: { page: number; text: string }[],
    model: string,
  ): AiExtractionCandidate[] {
    if (response.model !== model || response.done_reason === "length") {
      throw new AiGatewayError("malformed_output", true);
    }
    let output: unknown;
    try {
      output = JSON.parse(response.message.content);
    } catch {
      const refusal =
        /^\s*(?:I cannot|I can't|I am unable|I'm sorry|Sorry)\b/i.test(
          response.message.content,
        );
      throw new AiGatewayError(
        refusal ? "refusal" : "malformed_output",
        !refusal,
      );
    }
    const candidates = supplierDocumentModelOutputSchema.safeParse(output);
    if (!candidates.success) throw new AiGatewayError("malformed_output", true);
    for (const candidate of candidates.data.candidates) {
      const { page, startOffset, endOffset, quote } = candidate.sourceSpan;
      const sourcePage = pages.find((entry) => entry.page === page);
      if (
        !sourcePage ||
        Array.from(sourcePage.text).slice(startOffset, endOffset).join("") !==
          quote
      )
        throw new AiGatewayError("malformed_output", true);
    }
    return candidates.data.candidates;
  }

  private async request(url: string, body: string) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.get<number>("AI_OLLAMA_TIMEOUT_MS") ?? 30_000,
    );
    try {
      const response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        throw new AiGatewayError("provider_failure", response.status >= 500);
      }
      const raw = await readBounded(response);
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new AiGatewayError("malformed_output", true);
      }
      const parsed = providerResponseSchema.safeParse(payload);
      if (!parsed.success) throw new AiGatewayError("malformed_output", true);
      return parsed.data;
    } catch (error) {
      if (error instanceof AiGatewayError) throw error;
      if (isAbortError(error)) throw new AiGatewayError("timeout", true);
      throw new AiGatewayError("provider_failure", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

async function readBounded(response: Response): Promise<string> {
  if (!response.body) throw new AiGatewayError("malformed_output");
  const reader: ReadableStreamDefaultReader<Uint8Array> = (
    response.body as ReadableStream<Uint8Array>
  ).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = (await reader.read()) as {
        done: boolean;
        value?: Uint8Array;
      };
      const { value, done } = chunk;
      if (done) break;
      if (!value) throw new AiGatewayError("malformed_output");
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES)
        throw new AiGatewayError("malformed_output");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
