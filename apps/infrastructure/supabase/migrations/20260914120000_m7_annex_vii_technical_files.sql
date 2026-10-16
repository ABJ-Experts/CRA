-- M7-01: product-scoped Annex VII workspaces. This is a drafting workspace,
-- not a legal-completeness certification or an attachment store (M8 owns files).

create table public.technical_file_templates (
  template_key text not null check (template_key = 'annex_vii'),
  template_version text not null check (char_length(btrim(template_version)) between 1 and 80),
  section_key text not null check (section_key in ('general_description','user_instructions','design_development_production','support_period_basis','vulnerability_handling','test_reports','release_sbom','standards_common_specifications')),
  heading text not null check (char_length(btrim(heading)) between 1 and 500),
  requirement_text text not null check (char_length(btrim(requirement_text)) between 1 and 8000),
  sort_order integer not null check (sort_order > 0),
  legal_source text not null check (char_length(btrim(legal_source)) between 1 and 2000),
  primary key (template_key, template_version, section_key),
  unique (template_key, template_version, sort_order)
);

insert into public.technical_file_templates(template_key,template_version,section_key,heading,requirement_text,sort_order,legal_source) values
 ('annex_vii','2024-01','general_description','General description','General description, intended purpose, product versions and hardware-specific markings or images where applicable.',1,'Regulation (EU) 2024/2847, Annex VII and Annex II'),
 ('annex_vii','2024-01','user_instructions','User instructions','User instructions and information supplied to users under Annex II.',2,'Regulation (EU) 2024/2847, Annex VII and Annex II'),
 ('annex_vii','2024-01','design_development_production','Design, development and production','Design, development, production and secure-development process information.',3,'Regulation (EU) 2024/2847, Annex VII'),
 ('annex_vii','2024-01','support_period_basis','Support-period basis','Structured support-period decision, justification and retained protection basis.',4,'Regulation (EU) 2024/2847, Annex VII'),
 ('annex_vii','2024-01','vulnerability_handling','Vulnerability handling','Vulnerability handling, disclosure policy and relevant triage records.',5,'Regulation (EU) 2024/2847, Annex VII'),
 ('annex_vii','2024-01','test_reports','Test reports','Test evidence and reports relevant to the applicable requirements.',6,'Regulation (EU) 2024/2847, Annex VII'),
 ('annex_vii','2024-01','release_sbom','Release SBOM','An explicit immutable SBOM document revision for a release.',7,'Regulation (EU) 2024/2847, Annex VII'),
 ('annex_vii','2024-01','standards_common_specifications','Standards and common specifications','Applied harmonised standards and common specifications, including editions and source revisions.',8,'Regulation (EU) 2024/2847, Annex VII')
on conflict (template_key,template_version,section_key) do nothing;

create table public.technical_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  template_key text not null default 'annex_vii' check (template_key = 'annex_vii'),
  template_version text not null check (char_length(btrim(template_version)) between 1 and 80),
  status text not null default 'active' check (status in ('active','archived')),
  version integer not null default 1 check (version > 0),
  create_idempotency_key uuid not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id,id),
  unique (organization_id,created_by,create_idempotency_key),
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict
);
create unique index technical_files_one_active_product_idx on public.technical_files(organization_id,product_id) where status='active';

create table public.technical_file_sections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  technical_file_id uuid not null,
  section_key text not null check (section_key in ('general_description','user_instructions','design_development_production','support_period_basis','vulnerability_handling','test_reports','release_sbom','standards_common_specifications')),
  heading text not null check (char_length(btrim(heading)) between 1 and 500),
  requirement_text text not null check (char_length(btrim(requirement_text)) between 1 and 8000),
  sort_order integer not null check (sort_order > 0),
  narrative text check (narrative is null or (narrative=btrim(narrative) and char_length(narrative)<=20000)),
  applicability text not null default 'applicable' check (applicability in ('applicable','not_applicable')),
  non_applicability_reason text check (non_applicability_reason is null or (non_applicability_reason=btrim(non_applicability_reason) and char_length(non_applicability_reason) between 1 and 2000)),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id,id), unique (technical_file_id,section_key), unique (technical_file_id,sort_order),
  foreign key (organization_id,technical_file_id) references public.technical_files(organization_id,id) on delete cascade,
  check ((applicability='applicable' and non_applicability_reason is null) or (applicability='not_applicable' and non_applicability_reason is not null))
);

create table public.technical_file_section_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  section_id uuid not null,
  source_kind text not null check (source_kind in ('product','release','support_period','sbom_document','finding','manual_reference')),
  record_id uuid,
  observed_revision text check (observed_revision is null or (observed_revision=btrim(observed_revision) and char_length(observed_revision) between 1 and 200)),
  title text not null check (title=btrim(title) and char_length(title) between 1 and 500),
  edition_or_revision text check (edition_or_revision is null or (edition_or_revision=btrim(edition_or_revision) and char_length(edition_or_revision) between 1 and 200)),
  issuer text check (issuer is null or (issuer=btrim(issuer) and char_length(issuer) between 1 and 300)),
  locator text check (locator is null or (locator=btrim(locator) and char_length(locator) between 1 and 2000)),
  rationale text check (rationale is null or (rationale=btrim(rationale) and char_length(rationale) between 1 and 2000)),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  foreign key (organization_id,section_id) references public.technical_file_sections(organization_id,id) on delete cascade,
  check ((source_kind='manual_reference' and record_id is null and observed_revision is null) or (source_kind<>'manual_reference' and record_id is not null and observed_revision is not null))
);
create index technical_file_sections_file_idx on public.technical_file_sections(organization_id,technical_file_id,sort_order);
create index technical_file_section_sources_section_idx on public.technical_file_section_sources(organization_id,section_id,created_at,id);
create unique index technical_file_mutation_idempotency_idx on public.audit_logs(organization_id,user_id,(changes->>'idempotencyKey'))
  where action in ('technical_file.section_updated','technical_file.source_linked','technical_file.source_unlinked') and changes ? 'idempotencyKey';

alter table public.technical_file_templates enable row level security;
alter table public.technical_files enable row level security;
alter table public.technical_file_sections enable row level security;
alter table public.technical_file_section_sources enable row level security;
revoke all on table public.technical_file_templates,public.technical_files,public.technical_file_sections,public.technical_file_section_sources from public,anon,authenticated;
grant select on public.technical_file_templates to service_role;
grant all on table public.technical_files,public.technical_file_sections,public.technical_file_section_sources to service_role;

create or replace function public.m7_technical_file_actor_can(p_organization_id uuid,p_actor_user_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  with membership as (select m.role from public.organization_members m join public.users u on u.id=m.user_id and u.is_active join public.organizations o on o.id=m.organization_id and o.is_active where m.organization_id=p_organization_id and m.user_id=p_actor_user_id),
  override_grant as (select (o.permissions->>p_permission)::boolean granted from membership m join public.base_role_permission_overrides o on o.organization_id=p_organization_id and o.base_role=m.role where jsonb_typeof(o.permissions->p_permission)='boolean'),
  custom_grant as (select bool_or((r.permissions->>p_permission)::boolean) or bool_or(p_permission='can_view_technical_files' and jsonb_typeof(r.permissions->'can_edit_technical_files')='boolean' and (r.permissions->>'can_edit_technical_files')::boolean) granted from membership m join public.user_role_assignments a on a.organization_id=p_organization_id and a.user_id=p_actor_user_id join public.custom_roles r on r.organization_id=a.organization_id and r.id=a.role_id where r.is_active and not r.is_deleted),
  base_grant as (select role in ('owner','admin') granted from membership)
  select case when exists(select 1 from override_grant) then (select granted from override_grant limit 1) else coalesce((select granted from base_grant),false) or coalesce((select granted from custom_grant),false) end
$$;

create or replace function public.m7_technical_file_source_current(p_organization_id uuid,p_product_id uuid,p_kind text,p_record_id uuid,p_observed_revision text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_kind='product' then return exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_record_id and p.id=p_product_id and p.archived_at is null and p.version::text=p_observed_revision); end if;
 if p_kind='release' then return exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.id=p_record_id and r.product_id=p_product_id and r.archived_at is null and r.version::text=p_observed_revision); end if;
 if p_kind='support_period' then return exists(select 1 from public.product_support_periods x where x.organization_id=p_organization_id and x.id=p_record_id and x.product_id=p_product_id and x.superseded_at is null and x.version::text=p_observed_revision); end if;
 if p_kind='sbom_document' then return exists(
   select 1
     from public.sbom_documents d
    where d.organization_id=p_organization_id and d.id=p_record_id and d.state='completed' and d.document_sha256=p_observed_revision
      and exists (
        select 1
          from public.sbom_document_sources ds
          join public.product_releases r on r.organization_id=ds.organization_id and r.id=ds.release_id
         where ds.organization_id=d.organization_id and ds.document_id=d.id and r.product_id=p_product_id and r.archived_at is null
      )
 ); end if;
 if p_kind='finding' then return exists(select 1 from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id where f.organization_id=p_organization_id and f.id=p_record_id and r.product_id=p_product_id and f.status='active' and f.source_record_version_id::text=p_observed_revision); end if;
 return false;
end $$;

create or replace function public.m7_technical_file_source_exists(p_organization_id uuid,p_kind text,p_record_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_kind='product' then return exists(select 1 from public.products where organization_id=p_organization_id and id=p_record_id); end if;
 if p_kind='release' then return exists(select 1 from public.product_releases where organization_id=p_organization_id and id=p_record_id); end if;
 if p_kind='support_period' then return exists(select 1 from public.product_support_periods where organization_id=p_organization_id and id=p_record_id); end if;
 if p_kind='sbom_document' then return exists(select 1 from public.sbom_documents where organization_id=p_organization_id and id=p_record_id); end if;
 if p_kind='finding' then return exists(select 1 from public.vulnerability_findings where organization_id=p_organization_id and id=p_record_id); end if;
 return false;
end $$;

create or replace function public.m7_technical_file_mutation_replay(p_organization_id uuid,p_actor_user_id uuid,p_idempotency_key uuid,p_payload_digest text,p_action text)
returns table(outcome text,section_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select case when audit.action=p_action and audit.changes->>'payloadDigest'=p_payload_digest then 'replayed' else 'idempotency_conflict' end,
         (audit.changes->>'sectionId')::uuid
    from public.audit_logs audit
   where audit.organization_id=p_organization_id and audit.user_id=p_actor_user_id
     and audit.changes->>'idempotencyKey'=p_idempotency_key::text
   order by audit.created_at desc,audit.id desc
   limit 1
$$;

create or replace function public.m7_technical_file_section_json(p_organization_id uuid,p_section_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',s.id,'key',s.section_key,'heading',s.heading,'requirementText',s.requirement_text,'sortOrder',s.sort_order,'narrative',s.narrative,'applicability',s.applicability,'nonApplicabilityReason',s.non_applicability_reason,'version',s.version,'status',case when s.applicability='not_applicable' then 'not_applicable' when exists(select 1 from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id and x.source_kind<>'manual_reference' and not public.m7_technical_file_source_exists(s.organization_id,x.source_kind,x.record_id)) then 'unavailable' when exists(select 1 from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id and x.source_kind<>'manual_reference' and not public.m7_technical_file_source_current(s.organization_id,f.product_id,x.source_kind,x.record_id,x.observed_revision)) then 'stale' when s.narrative is null and not exists(select 1 from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id) then 'incomplete' else 'complete' end,'sources',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'kind',x.source_kind,'recordId',x.record_id,'observedRevision',x.observed_revision,'title',x.title,'editionOrRevision',x.edition_or_revision,'issuer',x.issuer,'locator',x.locator,'rationale',x.rationale,'status',case when x.source_kind='manual_reference' then 'current' when public.m7_technical_file_source_current(s.organization_id,f.product_id,x.source_kind,x.record_id,x.observed_revision) then 'current' when public.m7_technical_file_source_exists(s.organization_id,x.source_kind,x.record_id) then 'stale' else 'unavailable' end,'createdAt',to_char(x.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by x.created_at,x.id) from public.technical_file_section_sources x where x.organization_id=s.organization_id and x.section_id=s.id),'[]'::jsonb),'updatedAt',to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where s.organization_id=p_organization_id and s.id=p_section_id
$$;

create or replace function public.get_technical_file(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_file public.technical_files%rowtype;
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 select * into v_file from public.technical_files where organization_id=p_organization_id and product_id=p_product_id and status='active';
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 return query select 'found'::text,jsonb_build_object('technicalFile',jsonb_build_object('id',v_file.id,'organizationId',v_file.organization_id,'productId',v_file.product_id,'templateKey',v_file.template_key,'templateVersion',v_file.template_version,'legalSource',(select legal_source from public.technical_file_templates where template_key=v_file.template_key and template_version=v_file.template_version order by sort_order limit 1),'status',v_file.status,'version',v_file.version,'sections',coalesce((select jsonb_agg(public.m7_technical_file_section_json(p_organization_id,s.id) order by s.sort_order) from public.technical_file_sections s where s.organization_id=p_organization_id and s.technical_file_id=v_file.id),'[]'::jsonb),'createdAt',to_char(v_file.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(v_file.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end $$;

create or replace function public.create_technical_file_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.technical_files%rowtype; v_existing public.technical_files%rowtype; v_template_version text := '2024-01';
begin
 if p_organization_id is null or p_actor_user_id is null or p_product_id is null or p_idempotency_key is null then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 if not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id and archived_at is null) then return query select 'not_found'::text,null::jsonb; return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_product_id::text,0));
 select * into v_existing from public.technical_files where organization_id=p_organization_id and created_by=p_actor_user_id and create_idempotency_key=p_idempotency_key; if found then if v_existing.product_id<>p_product_id then return query select 'invalid_request'::text,null::jsonb; else return query select 'found'::text,(select rpc.result from public.get_technical_file(p_organization_id,p_actor_user_id,p_product_id) as rpc); end if; return; end if;
 select * into v_file from public.technical_files where organization_id=p_organization_id and product_id=p_product_id and status='active'; if found then return query select 'found'::text,(select rpc.result from public.get_technical_file(p_organization_id,p_actor_user_id,p_product_id) as rpc); return; end if;
 insert into public.technical_files(organization_id,product_id,template_version,create_idempotency_key,created_by,updated_by) values(p_organization_id,p_product_id,v_template_version,p_idempotency_key,p_actor_user_id,p_actor_user_id) returning * into v_file;
 insert into public.technical_file_sections(organization_id,technical_file_id,section_key,heading,requirement_text,sort_order,updated_by) select p_organization_id,v_file.id,t.section_key,t.heading,t.requirement_text,t.sort_order,p_actor_user_id from public.technical_file_templates t where t.template_key='annex_vii' and t.template_version=v_template_version order by t.sort_order;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.created','technical_file',v_file.id::text,jsonb_build_object('productId',p_product_id,'templateVersion',v_template_version));
 return query select 'created'::text,(select rpc.result from public.get_technical_file(p_organization_id,p_actor_user_id,p_product_id) as rpc);
end $$;

create or replace function public.get_technical_file_section(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_section uuid;
begin if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 select s.id into v_section from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and s.section_key=p_section_key;
 if v_section is null then return query select 'not_found'::text,null::jsonb; else return query select 'found'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section)); end if; end $$;

create or replace function public.update_technical_file_section_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_expected_version integer,p_narrative text,p_applicability text,p_non_applicability_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.technical_file_sections%rowtype; v_digest text; v_replay record;
begin
 if p_expected_version<1 or p_idempotency_key is null or p_narrative is distinct from nullif(btrim(coalesce(p_narrative,'')),'') or p_applicability not in ('applicable','not_applicable') or (p_applicability='not_applicable' and char_length(btrim(coalesce(p_non_applicability_reason,''))) not between 1 and 2000) or (p_applicability='applicable' and p_non_applicability_reason is not null) then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 v_digest := encode(extensions.digest(jsonb_build_object('operation','update_section','productId',p_product_id,'sectionKey',p_section_key,'expectedVersion',p_expected_version,'narrative',nullif(btrim(coalesce(p_narrative,'')),''),'applicability',p_applicability,'nonApplicabilityReason',case when p_applicability='not_applicable' then btrim(p_non_applicability_reason) else null end)::text,'sha256'),'hex');
 select * into v_replay from public.m7_technical_file_mutation_replay(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,'technical_file.section_updated');
 if found then
   if v_replay.outcome='idempotency_conflict' then return query select 'idempotency_conflict'::text,null::jsonb; return; end if;
   return query select 'updated'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_replay.section_id)); return;
 end if;
 select s.* into v_section from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and s.section_key=p_section_key for update;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_section.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id)); return; end if;
 update public.technical_file_sections set narrative=nullif(btrim(coalesce(p_narrative,'')),''),applicability=p_applicability,non_applicability_reason=case when p_applicability='not_applicable' then btrim(p_non_applicability_reason) else null end,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where id=v_section.id returning * into v_section;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.section_updated','technical_file_section',v_section.id::text,jsonb_build_object('key',p_section_key,'sectionId',v_section.id,'idempotencyKey',p_idempotency_key,'payloadDigest',v_digest));
 return query select 'updated'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id));
end $$;

create or replace function public.add_technical_file_section_source_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_expected_version integer,p_source_kind text,p_record_id uuid,p_title text,p_edition_or_revision text,p_issuer text,p_locator text,p_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.technical_file_sections%rowtype; v_revision text; v_source_id uuid; v_source_title text; v_digest text; v_replay record;
begin
 if p_expected_version<1 or p_idempotency_key is null or p_source_kind not in ('product','release','support_period','sbom_document','finding','manual_reference') then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 v_digest := encode(extensions.digest(jsonb_build_object('operation','add_source','productId',p_product_id,'sectionKey',p_section_key,'expectedVersion',p_expected_version,'sourceKind',p_source_kind,'recordId',p_record_id,'title',nullif(btrim(coalesce(p_title,'')),''),'editionOrRevision',nullif(btrim(coalesce(p_edition_or_revision,'')),''),'issuer',nullif(btrim(coalesce(p_issuer,'')),''),'locator',nullif(btrim(coalesce(p_locator,'')),''),'rationale',nullif(btrim(coalesce(p_rationale,'')),''))::text,'sha256'),'hex');
 select * into v_replay from public.m7_technical_file_mutation_replay(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,'technical_file.source_linked');
 if found then
   if v_replay.outcome='idempotency_conflict' then return query select 'idempotency_conflict'::text,null::jsonb; return; end if;
   return query select 'created'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_replay.section_id)); return;
 end if;
 select s.* into v_section from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and s.section_key=p_section_key for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_section.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id)); return; end if;
 if p_source_kind='manual_reference' then if p_record_id is not null or char_length(btrim(coalesce(p_title,''))) not between 1 and 500 then return query select 'invalid_request'::text,null::jsonb; return; end if; insert into public.technical_file_section_sources(organization_id,section_id,source_kind,title,edition_or_revision,issuer,locator,rationale) values(p_organization_id,v_section.id,p_source_kind,btrim(p_title),nullif(btrim(coalesce(p_edition_or_revision,'')),''),nullif(btrim(coalesce(p_issuer,'')),''),nullif(btrim(coalesce(p_locator,'')),''),nullif(btrim(coalesce(p_rationale,'')),'')) returning id into v_source_id;
 else
   if p_record_id is null then return query select 'invalid_request'::text,null::jsonb; return; end if;
   if p_source_kind='product' then select p.version::text,p.name||' ('||p.internal_code||')' into v_revision,v_source_title from public.products p where p.organization_id=p_organization_id and p.id=p_record_id and p.id=p_product_id and p.archived_at is null; end if;
   if p_source_kind='release' then select r.version::text,r.label||' '||r.release_version into v_revision,v_source_title from public.product_releases r where r.organization_id=p_organization_id and r.id=p_record_id and r.product_id=p_product_id and r.archived_at is null; end if;
   if p_source_kind='support_period' then select x.version::text,'Support period ending '||to_char(x.support_ends_at at time zone 'UTC','YYYY-MM-DD') into v_revision,v_source_title from public.product_support_periods x where x.organization_id=p_organization_id and x.id=p_record_id and x.product_id=p_product_id and x.superseded_at is null; end if;
   if p_source_kind='sbom_document' then select d.document_sha256,'SBOM '||upper(d.format)||' '||d.specification_version||' '||left(d.document_sha256,12) into v_revision,v_source_title from public.sbom_documents d join public.sbom_document_sources ds on ds.organization_id=d.organization_id and ds.document_id=d.id join public.product_releases r on r.organization_id=ds.organization_id and r.id=ds.release_id where d.organization_id=p_organization_id and d.id=p_record_id and d.state='completed' and r.product_id=p_product_id and r.archived_at is null order by d.completed_at desc,d.id desc limit 1; end if;
   if p_source_kind='finding' then select f.source_record_version_id::text,'Vulnerability finding '||f.id::text into v_revision,v_source_title from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id where f.organization_id=p_organization_id and f.id=p_record_id and f.status='active' and r.product_id=p_product_id; end if;
   if v_revision is null then return query select 'not_found'::text,null::jsonb; return; end if;
   insert into public.technical_file_section_sources(organization_id,section_id,source_kind,record_id,observed_revision,title) values(p_organization_id,v_section.id,p_source_kind,p_record_id,v_revision,coalesce(nullif(btrim(coalesce(p_title,'')),''),v_source_title)) returning id into v_source_id;
 end if;
 update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where id=v_section.id returning * into v_section;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_linked','technical_file_section_source',v_source_id::text,jsonb_build_object('sectionKey',p_section_key,'sectionId',v_section.id,'sourceKind',p_source_kind,'idempotencyKey',p_idempotency_key,'payloadDigest',v_digest));
 return query select 'created'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id));
end $$;

create or replace function public.remove_technical_file_section_source_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_source_id uuid,p_expected_version integer,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_section public.technical_file_sections%rowtype; v_digest text; v_replay record;
begin
 if p_expected_version<1 or p_idempotency_key is null then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 v_digest := encode(extensions.digest(jsonb_build_object('operation','remove_source','productId',p_product_id,'sectionKey',p_section_key,'sourceId',p_source_id,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
 select * into v_replay from public.m7_technical_file_mutation_replay(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,'technical_file.source_unlinked');
 if found then
   if v_replay.outcome='idempotency_conflict' then return query select 'idempotency_conflict'::text,null::jsonb; return; end if;
   return query select 'deleted'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_replay.section_id)); return;
 end if;
 select s.* into v_section from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where f.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active' and s.section_key=p_section_key for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_section.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id)); return; end if;
 delete from public.technical_file_section_sources where organization_id=p_organization_id and section_id=v_section.id and id=p_source_id; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 update public.technical_file_sections set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where id=v_section.id returning * into v_section;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.source_unlinked','technical_file_section_source',p_source_id::text,jsonb_build_object('sectionKey',p_section_key,'sectionId',v_section.id,'idempotencyKey',p_idempotency_key,'payloadDigest',v_digest));
 return query select 'deleted'::text,jsonb_build_object('section',public.m7_technical_file_section_json(p_organization_id,v_section.id));
end $$;

revoke all on function public.m7_technical_file_actor_can(uuid,uuid,text),public.m7_technical_file_source_current(uuid,uuid,text,uuid,text),public.m7_technical_file_source_exists(uuid,text,uuid),public.m7_technical_file_mutation_replay(uuid,uuid,uuid,text,text),public.m7_technical_file_section_json(uuid,uuid),public.get_technical_file(uuid,uuid,uuid),public.create_technical_file_atomic(uuid,uuid,uuid,uuid),public.get_technical_file_section(uuid,uuid,uuid,text),public.update_technical_file_section_atomic(uuid,uuid,uuid,text,integer,text,text,text,uuid),public.add_technical_file_section_source_atomic(uuid,uuid,uuid,text,integer,text,uuid,text,text,text,text,text,uuid),public.remove_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,uuid) from public,anon,authenticated;
alter function public.m7_technical_file_actor_can(uuid,uuid,text) owner to postgres;
alter function public.m7_technical_file_source_current(uuid,uuid,text,uuid,text) owner to postgres;
alter function public.m7_technical_file_source_exists(uuid,text,uuid) owner to postgres;
alter function public.m7_technical_file_mutation_replay(uuid,uuid,uuid,text,text) owner to postgres;
alter function public.m7_technical_file_section_json(uuid,uuid) owner to postgres;
alter function public.get_technical_file(uuid,uuid,uuid) owner to postgres;
alter function public.create_technical_file_atomic(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.get_technical_file_section(uuid,uuid,uuid,text) owner to postgres;
alter function public.update_technical_file_section_atomic(uuid,uuid,uuid,text,integer,text,text,text,uuid) owner to postgres;
alter function public.add_technical_file_section_source_atomic(uuid,uuid,uuid,text,integer,text,uuid,text,text,text,text,text,uuid) owner to postgres;
alter function public.remove_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,uuid) owner to postgres;
grant execute on function public.get_technical_file(uuid,uuid,uuid),public.create_technical_file_atomic(uuid,uuid,uuid,uuid),public.get_technical_file_section(uuid,uuid,uuid,text),public.update_technical_file_section_atomic(uuid,uuid,uuid,text,integer,text,text,text,uuid),public.add_technical_file_section_source_atomic(uuid,uuid,uuid,text,integer,text,uuid,text,text,text,text,text,uuid),public.remove_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,uuid) to service_role;

notify pgrst, 'reload schema';
