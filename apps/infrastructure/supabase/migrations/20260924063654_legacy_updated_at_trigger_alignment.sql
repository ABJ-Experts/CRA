-- Close the M6-M9 timestamp trigger gap without rewriting rows or changing
-- RPC-authored timestamps. Existing commands that set updated_at explicitly
-- retain their value; the standard trigger fills it only when unchanged.
-- Immutable records retain their separate rejection triggers.

create trigger ai_inference_runs_set_updated_at before update on public.ai_inference_runs
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger evidence_bulk_intake_batches_set_updated_at before update on public.evidence_bulk_intake_batches
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger evidence_bulk_intake_items_set_updated_at before update on public.evidence_bulk_intake_items
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger evidence_document_extraction_jobs_set_updated_at before update on public.evidence_document_extraction_jobs
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger evidence_document_scan_jobs_set_updated_at before update on public.evidence_document_scan_jobs
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger evidence_document_version_texts_set_updated_at before update on public.evidence_document_version_texts
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger evidence_documents_set_updated_at before update on public.evidence_documents
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger supplier_contacts_set_updated_at before update on public.supplier_contacts
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger supplier_evidence_reminder_deliveries_set_updated_at before update on public.supplier_evidence_reminder_deliveries
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger supplier_evidence_requests_set_updated_at before update on public.supplier_evidence_requests
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger supplier_evidence_submissions_set_updated_at before update on public.supplier_evidence_submissions
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger supplier_organizations_set_updated_at before update on public.supplier_organizations
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger technical_file_declarations_set_updated_at before update on public.technical_file_declarations
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger technical_file_risk_registers_set_updated_at before update on public.technical_file_risk_registers
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger technical_file_risks_set_updated_at before update on public.technical_file_risks
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger technical_file_sections_set_updated_at before update on public.technical_file_sections
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
create trigger technical_files_set_updated_at before update on public.technical_files
  for each row when (new.updated_at is not distinct from old.updated_at) execute function public.set_updated_at();
