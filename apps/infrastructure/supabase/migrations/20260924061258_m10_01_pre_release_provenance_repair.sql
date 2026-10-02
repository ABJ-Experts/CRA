-- M10-01 pre-release provenance-only correction for the first local import.
-- A local development stack may have applied the original migration while the
-- evidence string still named an ephemeral extraction path. Guard that exact
-- prior hash, correct only provenance, and restore immutability in one txn.
do $repair$
declare
  v_old_hash constant text := '6c0981f0542a4f1e46374d90791141677ac565a64e8b7dfb7194172d77cf68d0';
  v_expected_hash constant text := '1a28baf6e6837b214223f9db5dbd88b20a5eecb87134877c406eab871fabd619';
  v_review constant text := 'Official Publications Office PDF https://op.europa.eu/o/opportal-service/download-handler?format=PDF&identifier=21b7d4eb-a6e2-11ef-85f0-01aa75ed71a1&language=en&productionSystem=cellar (SHA-256 e3ecaabddf6e321fa04097d15dfcccc7309d0fe5896240ab7625a27d74ab1b0a) pages 68-69 compared with pdftotext on 2026-09-24; EUR-Lex reuse terms checked.';
  v_stored_hash text;
  v_payload jsonb;
  v_new_hash text;
begin
  select p.content_hash into v_stored_hash
  from public.framework_pack_versions p
  where p.pack_key='cra-annex-i' and p.version_key='oj-2024-11-20-en'
  for update;
  if not found then raise exception 'Expected CRA Annex I pack is missing'; end if;
  if v_stored_hash=v_expected_hash then return; end if;
  if v_stored_hash<>v_old_hash then
    raise exception 'Unexpected CRA Annex I digest; provenance repair refused';
  end if;
  select jsonb_build_object(
    'schemaVersion',1,'packKey',p.pack_key,'versionKey',p.version_key,
    'title',p.title,'editionDate',p.edition_date::text,'language',p.language,
    'sourceUrl',p.source_url,'sourceCelex',p.source_celex,'sourceEli',p.source_eli,
    'sourcePublicationDate',p.source_publication_date::text,
    'attribution',p.attribution,'reviewEvidence',p.review_evidence,
    'requirements',(select jsonb_agg(jsonb_build_object(
      'requirementKey',r.requirement_key,'identifier',r.identifier,
      'parentKey',r.parent_requirement_key,'position',r.position,
      'heading',r.heading,'text',r.text,'sourceReference',r.source_reference)
      order by r.tree_order) from public.framework_requirements r
      where r.pack_key=p.pack_key and r.version_key=p.version_key))
  into v_payload
  from public.framework_pack_versions p
  where p.pack_key='cra-annex-i' and p.version_key='oj-2024-11-20-en';
  if encode(extensions.digest(v_payload::text,'sha256'),'hex')<>v_old_hash then
    raise exception 'Stored CRA Annex I requirements do not match prior digest';
  end if;
  v_new_hash:=encode(extensions.digest(
    jsonb_set(v_payload,'{reviewEvidence}',to_jsonb(v_review))::text,'sha256'),'hex');
  if v_new_hash<>v_expected_hash then
    raise exception 'Reviewed CRA Annex I provenance does not match expected digest';
  end if;
  execute 'alter table public.framework_pack_versions disable trigger framework_pack_versions_immutable';
  update public.framework_pack_versions
    set review_evidence=v_review,content_hash=v_new_hash
    where pack_key='cra-annex-i' and version_key='oj-2024-11-20-en'
      and content_hash=v_old_hash;
  if not found then raise exception 'CRA Annex I provenance correction lost its lock'; end if;
  execute 'alter table public.framework_pack_versions enable trigger framework_pack_versions_immutable';
  insert into public.audit_logs(action,entity_type,entity_id,changes)
  values('framework.pack_provenance_corrected','framework_pack_version',
    'cra-annex-i:oj-2024-11-20-en',jsonb_build_object(
      'oldContentHash',v_old_hash,'contentHash',v_new_hash,
      'reason','Pre-release durable source review reference'));
end $repair$;
