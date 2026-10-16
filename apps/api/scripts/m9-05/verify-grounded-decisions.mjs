/** Read-only service-role verification for the opt-in synthetic browser test. */
import { createClient } from "@supabase/supabase-js";

const organizationId = "00000000-0000-4000-8000-0000000000ca";
const submissionId = "dfe889f8-b222-4a4e-b8f2-f742615be527";
const versionId = "8df5afa7-0044-45f5-b079-cff674aa3fed";
const runId = "bbd3b891-f92d-43de-8e86-3098474b0484";
const sha256 =
  "04ccb1df0719d6643883fe20f999a0ca2bef79f313b6de5453e79ac20f04a37e";

function localClient() {
  if (process.env.M9_05_ALLOW_LOCAL_FIXTURE !== "yes")
    throw new Error("M9_05_ALLOW_LOCAL_FIXTURE=yes is required");
  const raw = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw || !key)
    throw new Error("Local service-role configuration is required");
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.port !== "54321" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Verification is restricted to local Supabase port 54321");
  return createClient(url.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function checked(query, label) {
  const { data, error } = await query;
  if (error || !data)
    throw new Error(`${label}: ${error?.message ?? "no data"}`);
  return data;
}

async function verify() {
  const db = localClient();
  const fields = await checked(
    db
      .from("supplier_document_fields")
      .select(
        "id,field_key,original_value,corrected_value,status,source_span,reviewed_by_user_id,reviewed_at,evidence_version_id,evidence_sha256",
      )
      .eq("organization_id", organizationId)
      .eq("submission_id", submissionId)
      .eq("run_id", runId),
    "Fixture fields",
  );
  if (fields.length !== 2)
    throw new Error(`Expected two AI fields; found ${fields.length}`);
  const certificate = fields.find(
    (field) => field.field_key === "certification_held",
  );
  const expiry = fields.find((field) => field.field_key === "valid_until");
  if (
    certificate?.status !== "confirmed" ||
    certificate.original_value !== "ISO 9001:2015" ||
    certificate.corrected_value !== "ISO 9001:2015 (reviewed)" ||
    expiry?.status !== "rejected" ||
    expiry.original_value !== "2027-12-31" ||
    expiry.corrected_value !== null
  )
    throw new Error("Browser decisions did not persist exact values/statuses");
  const owner = await checked(
    db.from("users").select("id").eq("email", "owner@cra.test").single(),
    "Seeded owner",
  );
  for (const field of fields) {
    if (
      field.reviewed_by_user_id !== owner.id ||
      !field.reviewed_at ||
      field.evidence_version_id !== versionId ||
      field.evidence_sha256 !== sha256 ||
      !field.source_span
    )
      throw new Error(`Field provenance/actor mismatch for ${field.id}`);
  }
  const audits = await checked(
    db
      .from("audit_logs")
      .select("id,action,user_id,entity_id,changes")
      .eq("organization_id", organizationId)
      .eq("entity_type", "supplier_document_field")
      .in(
        "entity_id",
        fields.map((field) => field.id),
      ),
    "Field decision audits",
  );
  if (
    audits.length !== 2 ||
    !audits.some(
      (row) =>
        row.action === "supplier.document_field_confirmed" &&
        row.entity_id === certificate.id,
    ) ||
    !audits.some(
      (row) =>
        row.action === "supplier.document_field_rejected" &&
        row.entity_id === expiry.id,
    ) ||
    audits.some((row) => row.user_id !== owner.id)
  )
    throw new Error("Expected exactly one durable audit per field decision");
  const version = await checked(
    db
      .from("evidence_document_versions")
      .select("original_sha256,processing_state")
      .eq("organization_id", organizationId)
      .eq("id", versionId)
      .single(),
    "Pinned source version",
  );
  if (
    version.original_sha256 !== sha256 ||
    version.processing_state !== "clean"
  )
    throw new Error("Source evidence changed during field decisions");
  process.stdout.write(
    JSON.stringify({
      runId,
      statuses: {
        certification_held: certificate.status,
        valid_until: expiry.status,
      },
      actorId: owner.id,
      auditCount: audits.length,
      sourceUnchanged: true,
    }) + "\n",
  );
}

verify().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Verification failed"}\n`,
  );
  process.exitCode = 1;
});
