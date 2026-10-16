-- Advisor hardening for M8-06 service-only tables and helper functions.

revoke all on function public.m8_06_sync_bulk_item_from_version() from public, anon, authenticated;
revoke all on function public.m8_06_block_cancelled_bulk_finalization() from public, anon, authenticated;
revoke all on function public.m8_06_enqueue_watermark_cleanup_after_deletion_intent() from public, anon, authenticated;

drop policy if exists evidence_bulk_intake_batches_service_only on public.evidence_bulk_intake_batches;
create policy evidence_bulk_intake_batches_service_only
  on public.evidence_bulk_intake_batches
  for all to anon, authenticated
  using (false)
  with check (false);

drop policy if exists evidence_bulk_intake_items_service_only on public.evidence_bulk_intake_items;
create policy evidence_bulk_intake_items_service_only
  on public.evidence_bulk_intake_items
  for all to anon, authenticated
  using (false)
  with check (false);

drop policy if exists evidence_bulk_intake_attempts_service_only on public.evidence_bulk_intake_attempts;
create policy evidence_bulk_intake_attempts_service_only
  on public.evidence_bulk_intake_attempts
  for all to anon, authenticated
  using (false)
  with check (false);

drop policy if exists evidence_document_watermark_exports_service_only on public.evidence_document_watermark_exports;
create policy evidence_document_watermark_exports_service_only
  on public.evidence_document_watermark_exports
  for all to anon, authenticated
  using (false)
  with check (false);

drop policy if exists evidence_document_watermark_access_service_only on public.evidence_document_watermark_export_access_grants;
create policy evidence_document_watermark_access_service_only
  on public.evidence_document_watermark_export_access_grants
  for all to anon, authenticated
  using (false)
  with check (false);

create index if not exists evidence_bulk_attempts_document_idx
  on public.evidence_bulk_intake_attempts(organization_id, document_id);

create index if not exists evidence_bulk_batches_created_by_idx
  on public.evidence_bulk_intake_batches(created_by_user_id);

create index if not exists evidence_bulk_items_classification_actor_idx
  on public.evidence_bulk_intake_items(classification_confirmed_by_user_id);

create index if not exists evidence_bulk_items_current_version_idx
  on public.evidence_bulk_intake_items(organization_id, current_version_id);

create index if not exists evidence_bulk_items_document_idx
  on public.evidence_bulk_intake_items(organization_id, document_id);

create index if not exists evidence_bulk_items_owner_idx
  on public.evidence_bulk_intake_items(owner_user_id);

create index if not exists evidence_watermark_access_export_idx
  on public.evidence_document_watermark_export_access_grants(organization_id, export_id);

create index if not exists evidence_watermark_access_actor_idx
  on public.evidence_document_watermark_export_access_grants(actor_user_id);

create index if not exists evidence_watermark_exports_document_idx
  on public.evidence_document_watermark_exports(organization_id, document_id);

create index if not exists evidence_watermark_exports_product_idx
  on public.evidence_document_watermark_exports(organization_id, product_id);

create index if not exists evidence_watermark_exports_requested_by_idx
  on public.evidence_document_watermark_exports(requested_by_user_id);
