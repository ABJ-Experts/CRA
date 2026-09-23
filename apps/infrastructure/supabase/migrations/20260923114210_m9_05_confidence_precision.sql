-- The original numeric(5,4) rounded 0.79996 up to 0.8000 before the
-- confirmation guard read it. Preserve model precision for future candidates.
alter table public.supplier_document_fields
  alter column confidence type numeric using confidence::numeric;

-- An existing pending 0.8000 could have been rounded from below the policy
-- threshold. Conservatively keep such ambiguous legacy suggestions out of
-- single-field confirmation while leaving their source and review state intact.
update public.supplier_document_fields
set confidence=0.79999
where status='pending' and run_id is not null and confidence=0.8;
