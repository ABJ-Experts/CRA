-- M7-03: version-pinned evidence links, explicit stale review, and
-- documentation readiness. M8 remains the evidence-document authority.

alter table public.technical_file_templates
  add column requires_narrative boolean not null default true,
  add column requires_evidence boolean not null default true,
  add column allowed_source_kinds text[] not null default array['product','release','support_period','sbom_document','finding','manual_reference'];

alter table public.technical_file_templates
  add constraint technical_file_templates_allowed_source_kinds_check
  check (cardinality(allowed_source_kinds) > 0 and allowed_source_kinds <@ array['product','release','support_period','sbom_document','finding','risk_register','manual_reference']);

update public.technical_file_templates set allowed_source_kinds = case section_key
  when 'general_description' then array['product']
  when 'support_period_basis' then array['support_period']
  when 'vulnerability_handling' then array['finding','risk_register']
  when 'release_sbom' then array['sbom_document']
  else array['product','release','support_period','sbom_document','finding','risk_register','manual_reference']
end;

alter table public.technical_file_section_sources
  drop constraint technical_file_section_sources_source_kind_check,
  add constraint technical_file_section_sources_source_kind_check
    check (source_kind in ('product','release','support_period','sbom_document','finding','risk_register','manual_reference')),
  add column source_fingerprint text,
  add column link_version integer not null default 1 check (link_version > 0),
  add column stale_at timestamptz,
  add column stale_reason text,
  add column stale_current_revision text,
  add column stale_current_fingerprint text,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.users(id) on delete restrict,
  add column reviewed_revision text,
  add column reviewed_fingerprint text,
  add constraint technical_file_section_sources_fingerprint_check check (source_fingerprint is null or (source_fingerprint=btrim(source_fingerprint) and char_length(source_fingerprint) between 1 and 200)),
  add constraint technical_file_section_sources_stale_check check (
    (stale_at is null and stale_reason is null and stale_current_revision is null and stale_current_fingerprint is null)
    or (stale_at is not null and stale_reason is not null)
  ),
  add constraint technical_file_section_sources_review_check check (
    (reviewed_at is null and reviewed_by is null and reviewed_revision is null and reviewed_fingerprint is null)
    or (reviewed_at is not null and reviewed_by is not null)
  );

create table public.technical_file_section_source_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null,
  decision text not null check (decision in ('retain','update')),
  rationale text not null check (rationale=btrim(rationale) and char_length(rationale) between 1 and 4000),
  linked_revision text,
  linked_fingerprint text,
  reviewed_against_revision text,
  reviewed_against_fingerprint text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id,source_id) references public.technical_file_section_sources(organization_id,id) on delete restrict
);

create index technical_file_section_sources_reverse_idx
  on public.technical_file_section_sources(organization_id,source_kind,record_id,id)
  where record_id is not null;
create index technical_file_section_sources_stale_idx
  on public.technical_file_section_sources(organization_id,stale_at,id)
  where stale_at is not null;
create index technical_file_section_source_reviews_source_idx
  on public.technical_file_section_source_reviews(organization_id,source_id,created_at desc,id);

alter table public.technical_file_section_source_reviews enable row level security;
revoke all on table public.technical_file_section_source_reviews from public,anon,authenticated;
grant all on table public.technical_file_section_source_reviews to service_role;

create or replace function public.m7_evidence_source_snapshot(p_organization_id uuid,p_product_id uuid,p_kind text,p_record_id uuid)
returns table(exists_now boolean,is_current boolean,revision text,fingerprint text,title text,availability_reason text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if p_kind='product' then
    return query select true,p.archived_at is null,p.version::text,encode(extensions.digest(concat_ws('|',p.id::text,p.version::text,p.archived_at::text),'sha256'),'hex'),p.name,case when p.archived_at is null then null else 'product_archived' end from public.products p where p.organization_id=p_organization_id and p.id=p_record_id and p.id=p_product_id;
  elsif p_kind='release' then
    return query select true,r.archived_at is null,r.version::text,encode(extensions.digest(concat_ws('|',r.id::text,r.version::text,r.archived_at::text),'sha256'),'hex'),r.label,case when r.archived_at is null then null else 'release_archived' end from public.product_releases r where r.organization_id=p_organization_id and r.id=p_record_id and r.product_id=p_product_id;
  elsif p_kind='support_period' then
    return query select true,x.superseded_at is null,x.version::text,encode(extensions.digest(concat_ws('|',x.id::text,x.version::text,x.superseded_at::text),'sha256'),'hex'),'Support period',case when x.superseded_at is null then null else 'support_period_superseded' end from public.product_support_periods x where x.organization_id=p_organization_id and x.id=p_record_id and x.product_id=p_product_id;
  elsif p_kind='sbom_document' then
    return query select true,d.state='completed' and exists(select 1 from public.sbom_document_sources ds join public.product_releases r on r.organization_id=ds.organization_id and r.id=ds.release_id where ds.organization_id=d.organization_id and ds.document_id=d.id and r.product_id=p_product_id and r.archived_at is null),d.document_sha256,d.document_sha256,'SBOM document',case when d.state<>'completed' then 'sbom_not_completed' when not exists(select 1 from public.sbom_document_sources ds join public.product_releases r on r.organization_id=ds.organization_id and r.id=ds.release_id where ds.organization_id=d.organization_id and ds.document_id=d.id and r.product_id=p_product_id and r.archived_at is null) then 'sbom_release_unavailable' else null end from public.sbom_documents d where d.organization_id=p_organization_id and d.id=p_record_id;
  elsif p_kind='finding' then
    return query select true,f.status='active',f.source_record_version_id::text,encode(extensions.digest(concat_ws('|',f.id::text,f.source_record_version_id::text,f.status),'sha256'),'hex'),f.canonical_advisory_id,case when f.status='active' then null else 'finding_unavailable' end from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id where f.organization_id=p_organization_id and f.id=p_record_id and r.product_id=p_product_id;
  elsif p_kind='risk_register' then
    return query select true,true,rr.version::text,encode(extensions.digest(concat_ws('|',rr.id::text,rr.version::text),'sha256'),'hex'),'Cybersecurity risk register',null from public.technical_file_risk_registers rr join public.technical_files tf on tf.organization_id=rr.organization_id and tf.id=rr.technical_file_id where rr.organization_id=p_organization_id and rr.id=p_record_id and tf.product_id=p_product_id and tf.status='active';
  end if;
end $$;

update public.technical_file_section_sources x
   set source_fingerprint = (select snapshot.fingerprint from public.m7_evidence_source_snapshot(x.organization_id,f.product_id,x.source_kind,x.record_id) snapshot)
  from public.technical_file_sections s
  join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id
 where x.organization_id=s.organization_id and x.section_id=s.id
   and x.source_kind<>'manual_reference'
   and exists(select 1 from public.m7_evidence_source_snapshot(x.organization_id,f.product_id,x.source_kind,x.record_id) snapshot where snapshot.is_current);

update public.technical_file_section_sources
   set source_fingerprint=encode(extensions.digest(concat_ws('|',title,edition_or_revision,issuer,locator),'sha256'),'hex')
 where source_kind='manual_reference' and source_fingerprint is null;

create or replace function public.m7_evidence_section_source_state(p_organization_id uuid,p_product_id uuid,p_source_id uuid)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_source public.technical_file_section_sources%rowtype; v_snapshot record;
begin
  select * into v_source from public.technical_file_section_sources where organization_id=p_organization_id and id=p_source_id;
  if not found then return 'unavailable'; end if;
  if v_source.source_kind='manual_reference' then return case when v_source.stale_at is null then 'current' else 'stale' end; end if;
  select * into v_snapshot from public.m7_evidence_source_snapshot(p_organization_id,p_product_id,v_source.source_kind,v_source.record_id);
  if not found or not v_snapshot.exists_now or not v_snapshot.is_current then return 'unavailable'; end if;
  if v_source.stale_at is not null or v_source.observed_revision<>v_snapshot.revision or coalesce(v_source.source_fingerprint,'')<>coalesce(v_snapshot.fingerprint,'') then return 'stale'; end if;
  return 'current';
end $$;

create or replace function public.m7_evidence_readiness_json(p_organization_id uuid,p_product_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with active_file as (select f.* from public.technical_files f where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active'),
  rows as (
    select s.id,s.section_key,s.heading,s.sort_order,s.applicability,s.narrative,t.requires_narrative,t.requires_evidence,t.allowed_source_kinds,
      coalesce((select bool_or(public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='stale') from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),false) as has_stale,
      coalesce((select bool_or(public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='unavailable') from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),false) as has_unavailable,
      coalesce((select bool_or(public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='current' and x.source_kind=any(t.allowed_source_kinds)) from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),false) as has_valid_evidence
    from public.technical_file_sections s join active_file f on f.organization_id=s.organization_id and f.id=s.technical_file_id
    join public.technical_file_templates t on t.template_key=f.template_key and t.template_version=f.template_version and t.section_key=s.section_key
  ), assessed as (
    select *,case when applicability='not_applicable' then 'not_applicable'
      when has_stale then 'stale'
      when (requires_narrative and narrative is null) and (requires_evidence and not has_valid_evidence) then 'empty'
      when (requires_narrative and narrative is null) or (requires_evidence and not has_valid_evidence) or has_unavailable then 'partial'
      else 'complete' end status
    from rows
  ), gaps as (
    select jsonb_build_object('sectionId',id,'sectionKey',section_key,'heading',heading,'kind',kind,'priority',priority,'message',message) gap
    from assessed cross join lateral (values
      ('stale_source',case when status='stale' then 1 else 99 end,case when status='stale' then 'Review a material source change.' end),
      ('narrative',case when applicability='applicable' and requires_narrative and narrative is null then 2 else 99 end,case when applicability='applicable' and requires_narrative and narrative is null then 'Add the required narrative.' end),
      ('evidence',case when applicability='applicable' and requires_evidence and not has_valid_evidence then 3 else 99 end,case when applicability='applicable' and requires_evidence and not has_valid_evidence then 'Link valid evidence.' end),
      ('unavailable_source',case when has_unavailable then 4 else 99 end,case when has_unavailable then 'A linked source is unavailable.' end)
    ) g(kind,priority,message) where message is not null
  )
  select jsonb_build_object('status',case when not exists(select 1 from assessed where applicability='applicable') then 'empty' when exists(select 1 from assessed where status='stale') then 'stale' when exists(select 1 from assessed where status in ('empty','partial')) then 'partial' else 'complete' end,
    'sections',coalesce((select jsonb_agg(jsonb_build_object('sectionId',id,'sectionKey',section_key,'heading',heading,'status',status,'missingNarrative',applicability='applicable' and requires_narrative and narrative is null,'missingEvidence',applicability='applicable' and requires_evidence and not has_valid_evidence,'hasUnavailableEvidence',has_unavailable) order by sort_order) from assessed),'[]'::jsonb),
    'gaps',coalesce((select jsonb_agg(gap order by (gap->>'priority')::int,gap->>'sectionKey') from gaps),'[]'::jsonb),
    'calculatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
$$;

create or replace function public.get_technical_file_readiness(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
  if not exists(select 1 from public.technical_files f where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active') then return query select 'not_found',null::jsonb; return; end if;
  return query select 'found',jsonb_build_object('readiness',public.m7_evidence_readiness_json(p_organization_id,p_product_id));
end $$;

create or replace function public.recalculate_technical_file_readiness_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.technical_files%rowtype; v_digest text;
begin
  v_digest:=encode(extensions.digest(jsonb_build_object('operation','recalculate_readiness','productId',p_product_id)::text,'sha256'),'hex');
  if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
  select f.* into v_file from public.technical_files f where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if exists(select 1 from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.action='technical_file.readiness_recalculated' and a.changes->>'idempotencyKey'=p_idempotency_key::text and a.changes->>'payloadDigest'=v_digest) then return query select 'found',jsonb_build_object('readiness',public.m7_evidence_readiness_json(p_organization_id,p_product_id)); return; end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.readiness_recalculated','technical_file',v_file.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',v_digest));
  return query select 'found',jsonb_build_object('readiness',public.m7_evidence_readiness_json(p_organization_id,p_product_id));
end $$;

create or replace function public.mark_technical_file_section_source_material_change_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_source_id uuid,p_expected_version integer,p_reason text,p_current_revision text,p_current_fingerprint text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.technical_file_sections%rowtype; v_digest text;
begin
  v_digest:=encode(extensions.digest(jsonb_build_object('operation','material_change','sourceId',p_source_id,'sectionKey',p_section_key,'expectedVersion',p_expected_version,'reason',p_reason,'currentRevision',p_current_revision,'currentFingerprint',p_current_fingerprint)::text,'sha256'),'hex');
  if char_length(btrim(coalesce(p_reason,''))) not between 1 and 200 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
  select s.* into v_section from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where s.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and s.section_key=p_section_key for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_section.version<>p_expected_version then return query select 'conflict',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id)); return; end if;
  perform 1 from public.technical_file_section_sources where organization_id=p_organization_id and section_id=v_section.id and id=p_source_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  update public.technical_file_section_sources set stale_at=coalesce(stale_at,clock_timestamp()),stale_reason=btrim(p_reason),stale_current_revision=nullif(btrim(coalesce(p_current_revision,'')),''),stale_current_fingerprint=nullif(btrim(coalesce(p_current_fingerprint,'')),'' ) where organization_id=p_organization_id and id=p_source_id;
  update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=v_section.id returning * into v_section;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_marked_stale','technical_file_section_source',p_source_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',v_digest,'sectionId',v_section.id,'reason',btrim(p_reason)));
  return query select 'found',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id));
end $$;

create or replace function public.review_technical_file_section_source_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_source_id uuid,p_expected_version integer,p_decision text,p_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.technical_file_sections%rowtype; v_source public.technical_file_section_sources%rowtype; v_snapshot record; v_digest text;
begin
  v_digest:=encode(extensions.digest(jsonb_build_object('operation','review_source','sourceId',p_source_id,'sectionKey',p_section_key,'expectedVersion',p_expected_version,'decision',p_decision,'rationale',p_rationale)::text,'sha256'),'hex');
  if p_decision not in ('retain','update') or char_length(btrim(coalesce(p_rationale,''))) not between 1 and 4000 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
  select s.* into v_section from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where s.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and s.section_key=p_section_key for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_section.version<>p_expected_version then return query select 'conflict',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id)); return; end if;
  select * into v_source from public.technical_file_section_sources where organization_id=p_organization_id and section_id=v_section.id and id=p_source_id for update;
  if not found or v_source.stale_at is null then return query select 'invalid_request',null::jsonb; return; end if;
  if v_source.source_kind<>'manual_reference' then select * into v_snapshot from public.m7_evidence_source_snapshot(p_organization_id,p_product_id,v_source.source_kind,v_source.record_id); if p_decision='update' and (not found or not v_snapshot.is_current) then return query select 'invalid_request',null::jsonb; return; end if; end if;
  insert into public.technical_file_section_source_reviews(organization_id,source_id,decision,rationale,linked_revision,linked_fingerprint,reviewed_against_revision,reviewed_against_fingerprint,created_by) values(p_organization_id,p_source_id,p_decision,btrim(p_rationale),v_source.observed_revision,v_source.source_fingerprint,coalesce(v_snapshot.revision,v_source.stale_current_revision),coalesce(v_snapshot.fingerprint,v_source.stale_current_fingerprint),p_actor_user_id);
  update public.technical_file_section_sources set observed_revision=case when p_decision='update' then v_snapshot.revision else observed_revision end,source_fingerprint=case when p_decision='update' then v_snapshot.fingerprint else source_fingerprint end,stale_at=null,stale_reason=null,stale_current_revision=null,stale_current_fingerprint=null,reviewed_at=clock_timestamp(),reviewed_by=p_actor_user_id,reviewed_revision=coalesce(v_snapshot.revision,stale_current_revision),reviewed_fingerprint=coalesce(v_snapshot.fingerprint,stale_current_fingerprint) where organization_id=p_organization_id and id=p_source_id;
  update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=v_section.id returning * into v_section;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_reviewed','technical_file_section_source',p_source_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',v_digest,'sectionId',v_section.id,'decision',p_decision));
  return query select 'found',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id));
end $$;

create or replace function public.get_technical_file_evidence_reverse_links(p_organization_id uuid,p_actor_user_id uuid,p_source_kind text,p_record_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
  return query select 'found',jsonb_build_object('links',coalesce((select jsonb_agg(jsonb_build_object('sourceId',x.id,'technicalFileId',f.id,'productId',f.product_id,'sectionId',s.id,'sectionKey',s.section_key,'status',public.m7_evidence_section_source_state(p_organization_id,f.product_id,x.id)) order by f.product_id,s.sort_order,x.id) from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where x.organization_id=p_organization_id and x.source_kind=p_source_kind and x.record_id=p_record_id),'[]'::jsonb));
end $$;

-- Preserve the M7-01 wire function while extending its accepted evidence set.
create or replace function public.m7_technical_file_source_current(p_organization_id uuid,p_product_id uuid,p_kind text,p_record_id uuid,p_observed_revision text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_snapshot record;
begin
  select * into v_snapshot from public.m7_evidence_source_snapshot(p_organization_id,p_product_id,p_kind,p_record_id);
  return found and v_snapshot.is_current and v_snapshot.revision=p_observed_revision;
end $$;

create or replace function public.m7_technical_file_source_exists(p_organization_id uuid,p_kind text,p_record_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if p_kind='risk_register' then return exists(select 1 from public.technical_file_risk_registers where organization_id=p_organization_id and id=p_record_id); end if;
  if p_kind='product' then return exists(select 1 from public.products where organization_id=p_organization_id and id=p_record_id); end if;
  if p_kind='release' then return exists(select 1 from public.product_releases where organization_id=p_organization_id and id=p_record_id); end if;
  if p_kind='support_period' then return exists(select 1 from public.product_support_periods where organization_id=p_organization_id and id=p_record_id); end if;
  if p_kind='sbom_document' then return exists(select 1 from public.sbom_documents where organization_id=p_organization_id and id=p_record_id); end if;
  if p_kind='finding' then return exists(select 1 from public.vulnerability_findings where organization_id=p_organization_id and id=p_record_id); end if;
  return false;
end $$;

create or replace function public.add_technical_file_section_source_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_expected_version integer,p_source_kind text,p_record_id uuid,p_title text,p_edition_or_revision text,p_issuer text,p_locator text,p_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.technical_file_sections%rowtype; v_snapshot record; v_source_id uuid; v_digest text; v_replay record; v_allowed text[];
begin
  if p_expected_version<1 or p_idempotency_key is null or p_source_kind not in ('product','release','support_period','sbom_document','finding','risk_register','manual_reference') then return query select 'invalid_request',null::jsonb; return; end if;
  if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('operation','add_source','productId',p_product_id,'sectionKey',p_section_key,'expectedVersion',p_expected_version,'sourceKind',p_source_kind,'recordId',p_record_id,'title',nullif(btrim(coalesce(p_title,'')),''),'editionOrRevision',nullif(btrim(coalesce(p_edition_or_revision,'')),''),'issuer',nullif(btrim(coalesce(p_issuer,'')),''),'locator',nullif(btrim(coalesce(p_locator,'')),''),'rationale',nullif(btrim(coalesce(p_rationale,'')),''))::text,'sha256'),'hex');
  select * into v_replay from public.m7_technical_file_mutation_replay(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,'technical_file.source_linked');
  if found then if v_replay.outcome='idempotency_conflict' then return query select 'idempotency_conflict',null::jsonb; else return query select 'created',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_replay.section_id)); end if; return; end if;
  select s.* into v_section from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and s.section_key=p_section_key for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if v_section.version<>p_expected_version then return query select 'conflict',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id)); return; end if;
  select t.allowed_source_kinds into v_allowed from public.technical_files f join public.technical_file_templates t on t.template_key=f.template_key and t.template_version=f.template_version and t.section_key=p_section_key where f.organization_id=p_organization_id and f.id=v_section.technical_file_id;
  if not p_source_kind=any(v_allowed) then return query select 'invalid_request',null::jsonb; return; end if;
  if p_source_kind='manual_reference' then
    if p_record_id is not null or char_length(btrim(coalesce(p_title,''))) not between 1 and 500 then return query select 'invalid_request',null::jsonb; return; end if;
    insert into public.technical_file_section_sources(organization_id,section_id,source_kind,title,edition_or_revision,issuer,locator,rationale,source_fingerprint) values(p_organization_id,v_section.id,p_source_kind,btrim(p_title),nullif(btrim(coalesce(p_edition_or_revision,'')),''),nullif(btrim(coalesce(p_issuer,'')),''),nullif(btrim(coalesce(p_locator,'')),''),nullif(btrim(coalesce(p_rationale,'')),''),encode(extensions.digest(concat_ws('|',btrim(p_title),nullif(btrim(coalesce(p_edition_or_revision,'')),''),nullif(btrim(coalesce(p_issuer,'')),''),nullif(btrim(coalesce(p_locator,'')),'')),'sha256'),'hex')) returning id into v_source_id;
  else
    if p_record_id is null then return query select 'invalid_request',null::jsonb; return; end if;
    select * into v_snapshot from public.m7_evidence_source_snapshot(p_organization_id,p_product_id,p_source_kind,p_record_id);
    if not found or not v_snapshot.is_current then return query select 'not_found',null::jsonb; return; end if;
    insert into public.technical_file_section_sources(organization_id,section_id,source_kind,record_id,observed_revision,title,source_fingerprint) values(p_organization_id,v_section.id,p_source_kind,p_record_id,v_snapshot.revision,coalesce(nullif(btrim(coalesce(p_title,'')),''),v_snapshot.title),v_snapshot.fingerprint) returning id into v_source_id;
  end if;
  update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=v_section.id returning * into v_section;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_linked','technical_file_section_source',v_source_id::text,jsonb_build_object('sectionKey',p_section_key,'sectionId',v_section.id,'sourceKind',p_source_kind,'idempotencyKey',p_idempotency_key,'payloadDigest',v_digest));
  return query select 'created',jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id));
end $$;

revoke all on function public.m7_evidence_source_snapshot(uuid,uuid,text,uuid),public.m7_evidence_section_source_state(uuid,uuid,uuid),public.m7_evidence_readiness_json(uuid,uuid),public.get_technical_file_readiness(uuid,uuid,uuid),public.recalculate_technical_file_readiness_atomic(uuid,uuid,uuid,uuid),public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid),public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid),public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid) from public,anon,authenticated;
alter function public.m7_evidence_source_snapshot(uuid,uuid,text,uuid) owner to postgres;
alter function public.m7_evidence_section_source_state(uuid,uuid,uuid) owner to postgres;
alter function public.m7_evidence_readiness_json(uuid,uuid) owner to postgres;
alter function public.get_technical_file_readiness(uuid,uuid,uuid) owner to postgres;
alter function public.recalculate_technical_file_readiness_atomic(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid) owner to postgres;
alter function public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) owner to postgres;
alter function public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid) owner to postgres;
grant execute on function public.get_technical_file_readiness(uuid,uuid,uuid),public.recalculate_technical_file_readiness_atomic(uuid,uuid,uuid,uuid),public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid),public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid),public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid) to service_role;

-- M7-03 API projections. These are intentionally relationship-only; document
-- content and M8 visibility remain outside this feature.
create or replace function public.m7_evidence_link_json(p_organization_id uuid,p_product_id uuid,p_source_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',x.id,'sectionId',s.id,'sectionKey',s.section_key,'sourceKind',x.source_kind,'recordId',x.record_id,'linkVersion',x.link_version,'observedRevision',x.observed_revision,'sourceFingerprint',x.source_fingerprint,'availability',public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id),'staleAt',case when x.stale_at is null then null else to_char(x.stale_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'staleReason',x.stale_reason,'currentObservedRevision',x.stale_current_revision,'currentFingerprint',x.stale_current_fingerprint,'reviewedAt',case when x.reviewed_at is null then null else to_char(x.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'createdAt',to_char(x.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id
 where x.organization_id=p_organization_id and x.id=p_source_id
$$;

create or replace function public.m7_evidence_readiness_json(p_organization_id uuid,p_product_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with f as (select * from public.technical_files where organization_id=p_organization_id and product_id=p_product_id and status='active'),
r as (select s.id,s.section_key,s.applicability,s.narrative,t.requires_narrative,t.requires_evidence,
  coalesce((select count(*) filter(where public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='current' and x.source_kind=any(t.allowed_source_kinds)) from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),0)::int valid_count,
  coalesce((select count(*) filter(where public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='stale') from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),0)::int stale_count,
  coalesce((select count(*) filter(where public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='unavailable') from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),0)::int unavailable_count,
  coalesce((select array_agg(distinct x.stale_reason order by x.stale_reason) filter(where x.stale_reason is not null) from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),array[]::text[]) reasons
 from public.technical_file_sections s join f on f.organization_id=s.organization_id and f.id=s.technical_file_id join public.technical_file_templates t on t.template_key=f.template_key and t.template_version=f.template_version and t.section_key=s.section_key),
a as (select *,case when applicability='not_applicable' then 'complete' when stale_count>0 then 'stale' when (requires_narrative and narrative is null) and (requires_evidence and valid_count=0) then 'empty' when (requires_narrative and narrative is null) or (requires_evidence and valid_count=0) or unavailable_count>0 then 'partial' else 'complete' end status from r),
g as (select section_key,code,priority,action_label from a cross join lateral (values ('stale_evidence',1,'Review material source changes.'),('missing_narrative',2,'Add the required narrative.'),('missing_evidence',3,'Link valid evidence.'),('unavailable_evidence',4,'Replace unavailable evidence.')) v(code,priority,action_label) where (code='stale_evidence' and stale_count>0) or (code='missing_narrative' and applicability='applicable' and requires_narrative and narrative is null) or (code='missing_evidence' and applicability='applicable' and requires_evidence and valid_count=0) or (code='unavailable_evidence' and unavailable_count>0))
select jsonb_build_object('technicalFileId',(select id from f),'overallStatus',case when exists(select 1 from a where status='stale') then 'stale' when exists(select 1 from a where status in ('empty','partial')) then case when not exists(select 1 from a where status='partial') then 'empty' else 'partial' end else 'complete' end,'recalculationStatus','current','calculatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'sections',coalesce((select jsonb_agg(jsonb_build_object('sectionKey',section_key,'status',status,'gapCount',(select count(*) from g where g.section_key=a.section_key),'validEvidenceCount',valid_count,'staleEvidenceCount',stale_count,'unavailableEvidenceCount',unavailable_count,'staleReasons',to_jsonb(reasons),'gaps',coalesce((select jsonb_agg(jsonb_build_object('sectionKey',g.section_key,'code',g.code,'priority',g.priority,'actionLabel',g.action_label) order by g.priority) from g where g.section_key=a.section_key),'[]'::jsonb)) order by section_key) from a),'[]'::jsonb),'gaps',coalesce((select jsonb_agg(jsonb_build_object('sectionKey',section_key,'code',code,'priority',priority,'actionLabel',action_label) order by priority,section_key) from g),'[]'::jsonb))
$$;

drop function public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid);
create function public.mark_technical_file_section_source_material_change_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_source_id uuid,p_expected_version integer,p_reason text,p_current_observed_revision text,p_current_fingerprint text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.technical_file_sections%rowtype;
begin
 if p_reason not in ('product_facts_changed','release_changed','support_basis_changed','risk_register_changed','sbom_revision_changed','source_validity_changed','source_quarantined','standard_edition_changed','document_version_changed') or char_length(btrim(coalesce(p_current_fingerprint,''))) not between 1 and 200 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'invalid_request',null::jsonb; return; end if;
 select x.* into s from public.technical_file_sections x join public.technical_files f on f.organization_id=x.organization_id and f.id=x.technical_file_id where x.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and x.section_key=p_section_key for update;
 if not found then return query select 'not_found',null::jsonb; return; end if; if s.version<>p_expected_version then return query select 'conflict',jsonb_build_object('currentVersion',s.version); return; end if;
 update public.technical_file_section_sources set stale_at=coalesce(stale_at,clock_timestamp()),stale_reason=p_reason,stale_current_revision=p_current_observed_revision,stale_current_fingerprint=p_current_fingerprint,link_version=link_version+1 where organization_id=p_organization_id and section_id=s.id and id=p_source_id;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=s.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_marked_stale','technical_file_section_source',p_source_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 return query select 'marked_stale',jsonb_build_object('source',public.m7_evidence_link_json(p_organization_id,p_product_id,p_source_id));
end $$;

create or replace function public.review_technical_file_section_source_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_source_id uuid,p_expected_version integer,p_decision text,p_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.technical_file_sections%rowtype; x public.technical_file_section_sources%rowtype; snap record; review_id uuid;
begin
 if p_decision not in ('retain','update') or char_length(btrim(coalesce(p_rationale,''))) not between 1 and 4000 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'invalid_request',null::jsonb; return; end if;
 select q.* into s from public.technical_file_sections q join public.technical_files f on f.organization_id=q.organization_id and f.id=q.technical_file_id where q.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and q.section_key=p_section_key for update;
 if not found then return query select 'not_found',null::jsonb; return; end if; if s.version<>p_expected_version then return query select 'conflict',jsonb_build_object('currentVersion',s.version); return; end if;
 select * into x from public.technical_file_section_sources where organization_id=p_organization_id and section_id=s.id and id=p_source_id for update;
 if not found or x.stale_at is null then return query select 'invalid_request',null::jsonb; return; end if;
 if x.source_kind<>'manual_reference' then select * into snap from public.m7_evidence_source_snapshot(p_organization_id,p_product_id,x.source_kind,x.record_id); if p_decision='update' and (not found or not snap.is_current) then return query select 'invalid_request',null::jsonb; return; end if; end if;
 insert into public.technical_file_section_source_reviews(organization_id,source_id,decision,rationale,linked_revision,linked_fingerprint,reviewed_against_revision,reviewed_against_fingerprint,created_by) values(p_organization_id,p_source_id,p_decision,btrim(p_rationale),x.observed_revision,x.source_fingerprint,coalesce(snap.revision,x.stale_current_revision),coalesce(snap.fingerprint,x.stale_current_fingerprint),p_actor_user_id) returning id into review_id;
 update public.technical_file_section_sources set observed_revision=case when p_decision='update' then snap.revision else observed_revision end,source_fingerprint=case when p_decision='update' then snap.fingerprint else source_fingerprint end,stale_at=null,stale_reason=null,stale_current_revision=null,stale_current_fingerprint=null,reviewed_at=clock_timestamp(),reviewed_by=p_actor_user_id,reviewed_revision=coalesce(snap.revision,stale_current_revision),reviewed_fingerprint=coalesce(snap.fingerprint,stale_current_fingerprint),link_version=link_version+1 where organization_id=p_organization_id and id=p_source_id;
 update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=s.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_reviewed','technical_file_section_source',p_source_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'decision',p_decision));
 return query select 'reviewed',jsonb_build_object('source',public.m7_evidence_link_json(p_organization_id,p_product_id,p_source_id),'review', (select jsonb_build_object('id',r.id,'sourceId',r.source_id,'decision',r.decision,'rationale',r.rationale,'previousObservedRevision',r.linked_revision,'previousFingerprint',r.linked_fingerprint,'reviewedObservedRevision',r.reviewed_against_revision,'reviewedFingerprint',r.reviewed_against_fingerprint,'reviewedByUserId',r.created_by,'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) from public.technical_file_section_source_reviews r where r.organization_id=p_organization_id and r.id=review_id));
end $$;

revoke all on function public.m7_evidence_link_json(uuid,uuid,uuid),public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid),public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) from public,anon,authenticated;
alter function public.m7_evidence_link_json(uuid,uuid,uuid) owner to postgres;
alter function public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid) owner to postgres;
alter function public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) owner to postgres;
grant execute on function public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid),public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) to service_role;

notify pgrst, 'reload schema';
