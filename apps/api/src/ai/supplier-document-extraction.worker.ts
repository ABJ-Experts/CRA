import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { LocalEvidenceTextExtractorAdapter } from "../evidence/infrastructure/local-evidence-text-extractor.adapter";
import type { SupabaseEvidenceStorageAdapter } from "../evidence/infrastructure/supabase-evidence-storage.adapter";
import type { SupabaseService } from "../supabase/supabase.service";
import { AiGatewayError, type AiGateway } from "./ai-gateway";
import { SUPPLIER_FIELDS_PROMPT_VERSION } from "./supplier-fields.prompt";

type RpcClient = Readonly<{
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}>;

const uuid = z.uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const pageSchema = z
  .object({ page: z.number().int().positive(), text: z.string() })
  .strict();
const claimedSchema = z
  .array(
    z
      .object({
        id: uuid,
        organizationId: uuid,
        evidenceVersionId: uuid,
        evidenceSha256: sha256,
      })
      .passthrough(),
  )
  .max(10);
const contextSchema = z
  .object({
    organizationId: uuid,
    runId: uuid,
    evidenceVersionId: uuid,
    evidenceSha256: sha256,
    objectBucket: z.literal("evidence-documents"),
    objectKey: z.string().min(1),
    byteSize: z.number().int().positive(),
    mediaType: z.string().min(1),
    pageMap: z.array(pageSchema).min(1).max(500).nullable(),
    aiEnabled: z.boolean(),
    aiResidency: z.string(),
    maxInputTokens: z.number().int().positive().max(100_000),
  })
  .passthrough();

type Claim = z.output<typeof claimedSchema>[number];
type Context = z.output<typeof contextSchema>;
type FailureCode =
  | "provider_unavailable"
  | "timeout"
  | "refused"
  | "malformed_output"
  | "budget_exhausted"
  | "stale_source"
  | "no_evidence"
  | "policy_disabled"
  | "failed";

const RUN_TOKEN_CEILING = 10_000;
const MAX_AI_PAGES = 40;
const MAX_AI_PAGE_CHARACTERS = 20_000;
const MAX_AI_DOCUMENT_CHARACTERS = 80_000;

/** Database leases and scoped RPCs own authority, retry, and restart behavior. */
export class SupplierDocumentExtractionWorker {
  private readonly workerId: string;

  constructor(
    private readonly dependencies: Readonly<{
      supabase: Pick<SupabaseService, "admin">;
      storage: Pick<SupabaseEvidenceStorageAdapter, "openVerified">;
      extractor: Pick<LocalEvidenceTextExtractorAdapter, "extract">;
      gateway: Pick<AiGateway, "extractSupplierFields">;
    }>,
    workerId = randomUUID(),
  ) {
    this.workerId = workerId;
  }

  async runOnce(): Promise<number> {
    const client = this.dependencies.supabase.admin() as unknown as RpcClient;
    const claimed = await call(
      client,
      "claim_supplier_document_extraction_atomic",
      {
        p_worker_id: this.workerId,
        p_limit: 1,
      },
    );
    const runs = claimedSchema.safeParse(claimed);
    if (!runs.success) throw new Error("Supplier extraction claim malformed");
    for (const run of runs.data) await this.process(client, run);
    return runs.data.length;
  }

  private async process(client: RpcClient, claim: Claim): Promise<void> {
    let failure: FailureCode | null = null;
    let suggestions: unknown[] = [];
    let model = "local-ollama";
    let promptVersion = SUPPLIER_FIELDS_PROMPT_VERSION;
    try {
      const context = await this.getContext(client, claim);
      if (!context) throw new WorkerFailure("stale_source");
      if (!context.aiEnabled || context.aiResidency !== "local_only") {
        throw new WorkerFailure("policy_disabled");
      }
      const sourcePages = await this.pages(client, claim, context);
      const aiPages = boundedPages(sourcePages);
      if (aiPages.length === 0) throw new WorkerFailure("no_evidence");
      const result = await this.dependencies.gateway.extractSupplierFields({
        organizationId: claim.organizationId,
        versionId: claim.evidenceVersionId,
        sourceSha256: claim.evidenceSha256,
        pages: aiPages,
        policy: {
          enabled: true,
          mode: "local-only",
          remainingTokens: Math.min(context.maxInputTokens, RUN_TOKEN_CEILING),
        },
      });
      suggestions = result.candidates;
      model = result.model;
      promptVersion = result.promptVersion;
    } catch (error) {
      failure = failureCode(error);
    }
    const response = await call(
      client,
      "complete_supplier_document_extraction_atomic",
      {
        p_organization_id: claim.organizationId,
        p_worker_id: this.workerId,
        p_run_id: claim.id,
        p_model: model,
        p_prompt_version: promptVersion,
        p_suggestions: suggestions,
        p_failure_code: failure,
      },
    );
    const outcome = z
      .array(z.object({ outcome: z.string() }).passthrough())
      .safeParse(response);
    const status = outcome.success ? outcome.data[0]?.outcome : undefined;
    if (
      !status ||
      ![
        "completed",
        "failed",
        "stale_source",
        "policy_disabled",
        "replayed",
        "lease_lost",
      ].includes(status)
    ) {
      throw new Error("Supplier extraction completion was not accepted");
    }
  }

  private async getContext(
    client: RpcClient,
    claim: Claim,
  ): Promise<Context | null> {
    const raw = await call(
      client,
      "get_supplier_document_extraction_worker_atomic",
      {
        p_organization_id: claim.organizationId,
        p_worker_id: this.workerId,
        p_run_id: claim.id,
      },
    );
    if (raw === null) return null;
    const parsed = contextSchema.safeParse(raw);
    if (!parsed.success) throw new WorkerFailure("stale_source");
    const context = parsed.data;
    if (
      context.organizationId !== claim.organizationId ||
      context.runId !== claim.id ||
      context.evidenceVersionId !== claim.evidenceVersionId ||
      context.evidenceSha256 !== claim.evidenceSha256
    )
      throw new WorkerFailure("stale_source");
    return context;
  }

  private async pages(client: RpcClient, claim: Claim, context: Context) {
    if (context.pageMap) return context.pageMap;
    const stream = await this.dependencies.storage.openVerified({
      objectKey: context.objectKey,
      sha256: claim.evidenceSha256,
      byteSize: context.byteSize,
    });
    if (!stream) throw new WorkerFailure("no_evidence");
    const extraction = await this.dependencies.extractor.extract({
      source: stream,
      mediaType: context.mediaType,
    });
    if (extraction.outcome !== "complete") {
      throw new WorkerFailure(
        extraction.failureCode === "timeout" ? "timeout" : "no_evidence",
      );
    }
    const sourcePages = z
      .array(pageSchema)
      .min(1)
      .max(500)
      .safeParse(extraction.pages);
    if (!sourcePages.success) throw new WorkerFailure("no_evidence");
    const outcome = await call(
      client,
      "attach_supplier_document_page_map_atomic",
      {
        p_organization_id: claim.organizationId,
        p_worker_id: this.workerId,
        p_run_id: claim.id,
        p_page_map: sourcePages.data,
      },
    );
    if (outcome !== "attached" && outcome !== "replayed") {
      throw new WorkerFailure(
        outcome === "stale_source" ? "stale_source" : "failed",
      );
    }
    return sourcePages.data;
  }
}

class WorkerFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
  }
}

function failureCode(error: unknown): FailureCode {
  if (error instanceof WorkerFailure) return error.code;
  if (error instanceof AiGatewayError) {
    if (error.code === "timeout") return "timeout";
    if (error.code === "unavailable" || error.code === "provider_failure")
      return "provider_unavailable";
    if (error.code === "refusal") return "refused";
    if (error.code === "malformed_output") return "malformed_output";
    if (error.code === "budget_exhausted") return "budget_exhausted";
  }
  return "failed";
}

function boundedPages(pages: readonly { page: number; text: string }[]) {
  let remaining = MAX_AI_DOCUMENT_CHARACTERS;
  const selected: { page: number; text: string }[] = [];
  for (const page of pages) {
    if (selected.length >= MAX_AI_PAGES || remaining <= 0) break;
    const text = page.text.slice(
      0,
      Math.min(MAX_AI_PAGE_CHARACTERS, remaining),
    );
    if (!text.trim()) continue;
    selected.push({ page: page.page, text });
    remaining -= text.length;
  }
  return selected;
}

async function call(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await client.rpc(name, args);
  if (response.error)
    throw new Error(`Supplier extraction RPC ${name} unavailable`);
  return response.data;
}
