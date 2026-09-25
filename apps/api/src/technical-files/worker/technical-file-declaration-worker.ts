import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";

const bucket = "technical-file-declarations";
const claimSchema = z.object({
  declaration: z
    .object({
      id: z.uuid(),
      organizationId: z.uuid(),
      version: z.number().int().positive(),
    })
    .passthrough(),
  payload: z.record(z.string(), z.unknown()),
});

/** Renders only the transactionally frozen payload of one leased declaration. */
@Injectable()
export class TechnicalFileDeclarationWorker {
  constructor(private readonly supabase: SupabaseService) {}

  async processOne(
    workerId = randomUUID(),
  ): Promise<"empty" | "issued" | "failed"> {
    return this.claimAndProcessOne(workerId);
  }

  /** Global queue claim; tenant identity comes only from the leased record. */
  private async claimAndProcessOne(
    workerId: string,
  ): Promise<"empty" | "issued" | "failed"> {
    const claimed = await this.rpc("claim_technical_file_declaration", {
      p_worker_id: workerId,
      p_lease_seconds: 120,
    });
    if (claimed.outcome === "empty") return "empty";
    if (claimed.outcome !== "claimed")
      throw new Error("declaration claim unavailable");
    const claim = claimSchema.parse(claimed.result);
    try {
      const pdf = await renderDeclarationPdf(claim.payload);
      const path = `${claim.declaration.organizationId}/${claim.declaration.id}/eu-declaration-of-conformity-v${claim.declaration.version}.pdf`;
      const upload = await this.supabase
        .admin()
        .storage.from(bucket)
        .upload(path, pdf, { contentType: "application/pdf", upsert: false });
      if (upload.error && !/already exists/i.test(upload.error.message))
        throw new Error("storage_unavailable");
      const finalized = await this.finalizeStoredDeclaration({
        organizationId: claim.declaration.organizationId,
        declarationId: claim.declaration.id,
        workerId,
        objectPath: path,
        pdfSha256: digest(pdf),
        pdfBytes: pdf.byteLength,
      });
      if (!["issued", "replayed"].includes(finalized.outcome))
        throw new StorageFinalizationPendingError();
      return "issued";
    } catch (error) {
      if (error instanceof StorageFinalizationPendingError) return "failed";
      await this.rpc("fail_technical_file_declaration_atomic", {
        p_organization_id: claim.declaration.organizationId,
        p_declaration_id: claim.declaration.id,
        p_worker_id: workerId,
        p_failure_code:
          error instanceof z.ZodError
            ? "source_unavailable"
            : "renderer_unavailable",
      }).catch(() => undefined);
      return "failed";
    }
  }

  private async rpc(name: string, args: Record<string, unknown>) {
    const client = this.supabase.admin() as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    const response = await client.rpc(name, args);
    if (response.error)
      throw new Error(response.error.message ?? "declaration RPC unavailable");
    const row: unknown = Array.isArray(response.data)
      ? (response.data as unknown[])[0]
      : response.data;
    const parsed = z
      .object({ outcome: z.string(), result: z.unknown().nullable() })
      .safeParse(row);
    if (!parsed.success) throw new Error("invalid declaration RPC");
    return parsed.data;
  }

  private async finalizeStoredDeclaration(input: {
    organizationId: string;
    declarationId: string;
    workerId: string;
    objectPath: string;
    pdfSha256: string;
    pdfBytes: number;
  }) {
    try {
      return await this.rpc("finalize_technical_file_declaration_atomic", {
        p_organization_id: input.organizationId,
        p_declaration_id: input.declarationId,
        p_worker_id: input.workerId,
        p_pdf_object_path: input.objectPath,
        p_pdf_sha256: input.pdfSha256,
        p_pdf_bytes: input.pdfBytes,
      });
    } catch {
      throw new StorageFinalizationPendingError();
    }
  }
}

async function renderDeclarationPdf(
  payload: Record<string, unknown>,
): Promise<Buffer> {
  const doc = new PDFDocument({
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    compress: true,
  });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const write = (label: string, value: unknown) =>
    doc.text(`${label}: ${display(value)}`);
  const template = record(payload.template);
  const product = record(payload.product);
  const signatory = record(payload.signatory);
  const snapshot = record(payload.snapshot);
  const manufacturer = record(product.legal_entity_snapshot);
  doc.font("Helvetica-Bold").fontSize(18).text("EU Declaration of Conformity");
  doc.font("Helvetica").fontSize(10).moveDown();
  write("Template", template.key);
  write("Template version", template.version);
  write("Applicable legal act", template.regulationReference);
  doc.moveDown();
  write("Product identity", product.name);
  write("Product type", product.product_type);
  write("Product traceability", product.internal_code);
  write("Manufacturer", manufacturer.legalName ?? manufacturer.legal_name);
  write(
    "Manufacturer address",
    manufacturer.registeredAddress ?? manufacturer.registered_address,
  );
  write("Technical-file snapshot", snapshot.id);
  write("Snapshot SHA-256", snapshot.payloadSha256 ?? snapshot.payload_sha256);
  doc.moveDown();
  write("Responsible signatory", signatory.name);
  write("Signatory capacity", signatory.capacity);
  write("Place of issue", payload.issuePlace);
  write("Assessment route", payload.assessmentRoute ?? "Not recorded");
  write(
    "Notified-body identifier",
    payload.notifiedBodyIdentifier ?? "Not applicable",
  );
  write(
    "Certificate references",
    Array.isArray(payload.certificateReferences)
      ? payload.certificateReferences
          .map((reference) => display(record(reference).reference))
          .filter((reference) => reference !== "Not recorded")
          .join(", ") || "Not applicable"
      : "Not applicable",
  );
  doc.moveDown();
  doc.text(
    "This declaration identifies a responsible signatory and is not a cryptographic or qualified electronic signature.",
  );
  doc.end();
  return completed;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function display(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number")
    return "Not recorded";
  return (
    String(value)
      .replace(/[\p{Cc}]/gu, " ")
      .trim() || "Not recorded"
  );
}
function digest(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

class StorageFinalizationPendingError extends Error {
  constructor() {
    super("declaration storage succeeded but finalization is pending");
  }
}
