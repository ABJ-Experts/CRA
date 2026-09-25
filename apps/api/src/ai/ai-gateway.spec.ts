import { ConfigService } from "@nestjs/config";

import { AiGateway, AiGatewayError } from "./ai-gateway";

const source = "Certificate ISO 9001 valid until 2028-09-30.";
const span = { page: 1, startOffset: 12, endOffset: 20, quote: "ISO 9001" };
const candidate = {
  fieldKey: "certification_held",
  candidateGroup: "certificate-1",
  originalValue: "ISO 9001",
  confidence: 0.91,
  sourceSpan: span,
};

function gateway(
  fetcher: typeof fetch,
  overrides: Record<string, unknown> = {},
) {
  const values: Record<string, unknown> = {
    AI_OLLAMA_URL: "http://127.0.0.1:11434",
    AI_OLLAMA_MODEL: "qwen2.5:7b",
    AI_OLLAMA_TIMEOUT_MS: 1000,
    ...overrides,
  };
  return new AiGateway(
    { get: (key: string) => values[key] } as ConfigService,
    fetcher,
  );
}

const input = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  versionId: "00000000-0000-4000-8000-000000000002",
  sourceSha256: "a".repeat(64),
  pages: [{ page: 1, text: source }],
  policy: {
    enabled: true,
    mode: "local-only" as const,
    remainingTokens: 10_000,
  },
};

function reply(
  content: unknown,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({
      model: "qwen2.5:7b",
      message: { role: "assistant", content },
      prompt_eval_count: 50,
      eval_count: 40,
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("AiGateway", () => {
  it("uses the local configured model without tools and returns grounded candidates", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue(reply(JSON.stringify({ candidates: [candidate] })));
    const result = await gateway(fetcher as typeof fetch).extractSupplierFields(
      input,
    );
    expect(result.candidates).toEqual([candidate]);
    expect(result.model).toBe("qwen2.5:7b");
    expect(result.promptVersion).toMatch(/^supplier-fields-v\d+$/);
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(40);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(options.method).toBe("POST");
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "qwen2.5:7b", stream: false });
    expect(body.format).toMatchObject({ type: "object" });
    expect(body.format).toHaveProperty("properties.candidates");
    expect(body).not.toHaveProperty("tools");
  });

  it("fails closed on disabled policy, missing gateway, and exhausted budget", async () => {
    const fetcher = jest.fn();
    await expect(
      gateway(fetcher).extractSupplierFields({
        ...input,
        policy: { ...input.policy, enabled: false },
      }),
    ).rejects.toMatchObject({ code: "policy_denied" });
    await expect(
      gateway(fetcher, { AI_OLLAMA_URL: undefined }).extractSupplierFields(
        input,
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      gateway(fetcher).extractSupplierFields({
        ...input,
        policy: { ...input.policy, remainingTokens: 1 },
      }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [
      "unknown field",
      { candidates: [{ ...candidate, fieldKey: "admin_override" }] },
    ],
    [
      "extra property",
      { candidates: [{ ...candidate, instruction: "ignore rules" }] },
    ],
    [
      "wrong quote",
      {
        candidates: [{ ...candidate, sourceSpan: { ...span, quote: "fake" } }],
      },
    ],
    [
      "wrong offset",
      {
        candidates: [{ ...candidate, sourceSpan: { ...span, startOffset: 1 } }],
      },
    ],
  ])("rejects %s", async (_, output) => {
    const fetcher = jest.fn().mockResolvedValue(reply(JSON.stringify(output)));
    await expect(
      gateway(fetcher as typeof fetch).extractSupplierFields(input),
    ).rejects.toMatchObject({ code: "malformed_output" });
  });

  it("does not return a refusal or truncated output as a success", async () => {
    const refusal = jest
      .fn()
      .mockResolvedValue(reply("I cannot do that", { done_reason: "stop" }));
    await expect(
      gateway(refusal as typeof fetch).extractSupplierFields(input),
    ).rejects.toMatchObject({ code: "refusal" });
    const truncated = jest
      .fn()
      .mockResolvedValue(
        reply(JSON.stringify({ candidates: [] }), { done_reason: "length" }),
      );
    await expect(
      gateway(truncated as typeof fetch).extractSupplierFields(input),
    ).rejects.toMatchObject({ code: "malformed_output" });
  });

  it("retries a transient provider error exactly once", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(reply(JSON.stringify({ candidates: [] })));
    await expect(
      gateway(fetcher as typeof fetch).extractSupplierFields(input),
    ).resolves.toMatchObject({ candidates: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("records an aborted provider request as a timeout", async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    await expect(
      gateway(fetcher as typeof fetch).extractSupplierFields(input),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries malformed structured output once, then fails closed", async () => {
    const fetcher = jest.fn().mockResolvedValue(reply("{"));
    await expect(
      gateway(fetcher as typeof fetch).extractSupplierFields(input),
    ).rejects.toMatchObject({ code: "malformed_output" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-transient response", async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(
      gateway(fetcher as typeof fetch).extractSupplierFields(input),
    ).rejects.toBeInstanceOf(AiGatewayError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
