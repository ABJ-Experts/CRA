-- M3-05 lineage and diff projection. Source events and evidence are immutable;
-- aliases only point at an already completed graph and never extend a chain.

alter table public.sbom_sources
  add column deduplicated_from_source_id uuid;

alter table public.sbom_sources
  add constraint sbom_sources_deduplicated_not_self_check
    check (deduplicated_from_source_id is null or deduplicated_from_source_id <> id),
  add constraint sbom_sources_deduplicated_alias_check
    check (deduplicated_from_source_id is null or supersedes_source_id is null),
  add constraint sbom_sources_deduplicated_same_release_fkey
    foreign key (organization_id, release_id, deduplicated_from_source_id)
    references public.sbom_sources(organization_id, release_id, id) on delete restrict;

create unique index sbom_sources_one_chain_successor_idx
  on public.sbom_sources(organization_id, release_id, supersedes_source_id)
  where supersedes_source_id is not null and deduplicated_from_source_id is null;
create index sbom_sources_org_release_verified_idx
  on public.sbom_sources(organization_id, release_id, verified_at, id)
  where status = 'verified';
create index sbom_sources_deduplicated_from_idx
  on public.sbom_sources(organization_id, deduplicated_from_source_id)
  where deduplicated_from_source_id is not null;

create or replace function public.prevent_sbom_source_dedup_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.deduplicated_from_source_id is distinct from new.deduplicated_from_source_id then
    if old.deduplicated_from_source_id is not null
      or new.status <> 'verified'
      or new.raw_object_id is null
      or new.deduplicated_from_source_id is null
      or not exists (
        select 1 from public.sbom_sources canonical
        join public.sbom_document_sources mappings
          on mappings.organization_id = canonical.organization_id and mappings.source_id = canonical.id
        join public.sbom_documents documents
          on documents.organization_id = mappings.organization_id and documents.id = mappings.document_id
        where canonical.organization_id = new.organization_id
          and canonical.release_id = new.release_id
          and canonical.id = new.deduplicated_from_source_id
          and canonical.status = 'verified' and documents.state = 'completed'
      ) then
      raise exception using errcode = '55000', message = 'SBOM deduplication provenance is finalization-only';
    end if;
  end if;
  return new;
end;
$$;
create trigger prevent_sbom_source_dedup_mutation
  before update of deduplicated_from_source_id on public.sbom_sources
  for each row execute function public.prevent_sbom_source_dedup_mutation();

alter table public.sbom_component_identities
  drop constraint sbom_component_identities_identity_type_check,
  add constraint sbom_component_identities_identity_type_check
    check (identity_type in ('purl', 'purl_package', 'cpe', 'bom_ref', 'spdx_id', 'other'));

create or replace function public.sbom_purl_package_identity(p_canonical_purl text)
returns text language sql immutable strict set search_path = public, pg_temp as $$
  select regexp_replace(p_canonical_purl, '@[^?#]*', '');
$$;

create index sbom_component_identities_package_lookup_idx
  on public.sbom_component_identities(organization_id, document_id, canonical_value, component_id)
  where identity_type = 'purl_package' and canonical_value is not null;

create or replace function public.ensure_sbom_component_diff_identities_atomic(
  p_organization_id uuid, p_document_id uuid, p_limit integer
) returns table(outcome text, inserted_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_inserted integer;
begin
  if p_limit not between 1 and 5000 or not exists (
    select 1 from public.sbom_documents d
    where d.organization_id=p_organization_id and d.id=p_document_id and d.state='completed'
  ) then return query select 'not_found'::text, 0; return; end if;
  with candidates as (
    select c.id,c.canonical_purl from public.sbom_components c
    where c.organization_id=p_organization_id and c.document_id=p_document_id and c.canonical_purl is not null
      and not exists (
        select 1 from public.sbom_component_identities i
        where i.organization_id=c.organization_id and i.document_id=c.document_id and i.component_id=c.id
          and i.identity_type='purl_package'
      )
    order by c.source_offset,c.id limit p_limit
  )
  insert into public.sbom_component_identities(organization_id,document_id,component_id,identity_type,original_value,canonical_value)
  select p_organization_id,p_document_id,id,'purl_package',canonical_purl,public.sbom_purl_package_identity(canonical_purl)
  from candidates on conflict (organization_id,document_id,component_id,identity_type,original_value) do nothing;
  get diagnostics v_inserted = row_count;
  return query select 'persisted'::text, v_inserted;
end;
$$;

create table public.sbom_diff_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_id uuid not null,
  baseline_source_id uuid not null,
  release_id uuid not null,
  document_id uuid not null,
  baseline_document_id uuid not null,
  comparator_version text not null default 'm4-unavailable.v1' check (char_length(btrim(comparator_version)) between 1 and 120),
  state text not null default 'queued',
  finding_delta_state text not null default 'partial_integration_unavailable' check (finding_delta_state in ('partial_integration_unavailable','ready')),
  progress_stage text not null default 'queued' check (progress_stage in ('queued','projecting_identities','comparing','recording_changes','completed','failed')),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  progress_change_count integer not null default 0 check (progress_change_count >= 0),
  checkpoint jsonb not null default '{}'::jsonb check (jsonb_typeof(checkpoint)='object' and octet_length(checkpoint::text)<=32768),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  max_attempts integer not null default 5 check (max_attempts=5),
  next_attempt_at timestamptz not null default now(),
  lease_owner text check (lease_owner is null or char_length(btrim(lease_owner)) between 1 and 100),
  lease_expires_at timestamptz,
  error_code text check (error_code is null or error_code in ('baseline_unavailable','normalized_document_missing','diff_persistence_unavailable','diff_statement_timeout','diff_calculation_failed','provider_unavailable','unexpected_failure')),
  error_message text check (error_message is null or char_length(btrim(error_message)) between 1 and 1000),
  completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id),
  unique (organization_id,source_id,baseline_source_id,comparator_version),
  foreign key (organization_id,source_id) references public.sbom_sources(organization_id,id) on delete cascade,
  foreign key (organization_id,baseline_source_id) references public.sbom_sources(organization_id,id) on delete restrict,
  foreign key (organization_id,document_id,source_id) references public.sbom_document_sources(organization_id,document_id,source_id) on delete cascade,
  foreign key (organization_id,baseline_document_id,baseline_source_id) references public.sbom_document_sources(organization_id,document_id,source_id) on delete restrict,
  check (source_id <> baseline_source_id and document_id <> baseline_document_id),
  constraint sbom_diff_reports_state_check check (
    (state='queued' and progress_stage='queued' and lease_owner is null and lease_expires_at is null and completed_at is null and error_code is null and error_message is null)
    or (state='processing' and progress_stage in ('projecting_identities','comparing','recording_changes') and lease_owner is not null and lease_expires_at is not null and completed_at is null and error_code is null and error_message is null)
    or (state='completed' and progress_stage='completed' and progress_percent=100 and lease_owner is null and lease_expires_at is null and completed_at is not null and error_code is null and error_message is null)
    or (state='failed' and progress_stage='failed' and lease_owner is null and lease_expires_at is null and completed_at is null and error_code is not null and error_message is not null)
  )
);

create table public.sbom_diff_component_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null,
  change_key text not null check (char_length(btrim(change_key)) between 1 and 512),
  change_type text not null check (change_type in ('added','removed','unchanged','upgraded','downgraded','unresolved')),
  canonical_package_identity text check (canonical_package_identity is null or char_length(canonical_package_identity)<=4096),
  ecosystem text check (ecosystem is null or char_length(ecosystem)<=120),
  current_component_id uuid, baseline_component_id uuid,
  current_version text, baseline_version text,
  explanation text not null check (char_length(btrim(explanation)) between 1 and 2000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id,id), unique (organization_id,report_id,change_key),
  foreign key (organization_id,report_id) references public.sbom_diff_reports(organization_id,id) on delete cascade,
  foreign key (organization_id,current_component_id) references public.sbom_components(organization_id,id) on delete restrict,
  foreign key (organization_id,baseline_component_id) references public.sbom_components(organization_id,id) on delete restrict
);

create index sbom_diff_reports_org_source_idx on public.sbom_diff_reports(organization_id,source_id,created_at desc,id desc);
create index sbom_diff_reports_org_release_state_idx on public.sbom_diff_reports(organization_id,release_id,state,created_at,id);
create index sbom_diff_reports_claim_idx on public.sbom_diff_reports(organization_id,next_attempt_at,created_at,id) where state in ('queued','failed');
create index sbom_diff_reports_recovery_idx on public.sbom_diff_reports(organization_id,lease_expires_at) where state='processing';
create index sbom_diff_changes_cursor_idx on public.sbom_diff_component_changes(organization_id,report_id,created_at,id);
create index sbom_diff_changes_type_idx on public.sbom_diff_component_changes(organization_id,report_id,change_type,created_at,id);
create index sbom_diff_changes_identity_idx on public.sbom_diff_component_changes(organization_id,report_id,canonical_package_identity);

alter table public.sbom_diff_reports enable row level security;
alter table public.sbom_diff_component_changes enable row level security;
create policy sbom_diff_reports_select_member on public.sbom_diff_reports for select to authenticated using (public.user_is_member_of(organization_id));
create policy sbom_diff_component_changes_select_member on public.sbom_diff_component_changes for select to authenticated using (public.user_is_member_of(organization_id));
revoke all on public.sbom_diff_reports,public.sbom_diff_component_changes from public,anon,authenticated;
grant select,insert,update,delete on public.sbom_diff_reports,public.sbom_diff_component_changes to service_role;
create trigger set_sbom_diff_reports_updated_at before update on public.sbom_diff_reports for each row execute function public.set_updated_at();
create trigger set_sbom_diff_component_changes_updated_at before update on public.sbom_diff_component_changes for each row execute function public.set_updated_at();

create or replace function public.sbom_diff_cursor_encode(p_created_at timestamptz,p_id uuid) returns text
language sql immutable set search_path=public,pg_temp as $$ select encode(convert_to(jsonb_build_array(p_created_at,p_id)::text,'utf8'),'base64'); $$;
create or replace function public.sbom_diff_report_json(p_organization_id uuid,p_report_id uuid) returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'sourceId',r.source_id,'baselineSourceId',r.baseline_source_id,'releaseId',r.release_id,'documentId',r.document_id,'baselineDocumentId',r.baseline_document_id,'state',r.state,'comparatorVersion',r.comparator_version,'findingDelta',jsonb_build_object('state',r.finding_delta_state),'counts',jsonb_build_object('componentChanges',r.progress_change_count),'progress',jsonb_build_object('stage',r.progress_stage,'percent',r.progress_percent),'error',case when r.error_code is null then null else jsonb_build_object('code',r.error_code,'message',r.error_message,'retryable',r.attempt_count<r.max_attempts) end,'completedAt',r.completed_at,'createdAt',r.created_at,'updatedAt',r.updated_at) from public.sbom_diff_reports r where r.organization_id=p_organization_id and r.id=p_report_id;
$$;

create or replace function public.enqueue_sbom_diff_report_atomic(p_organization_id uuid,p_source_id uuid,p_baseline_source_id uuid)
returns table(outcome text,report jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_source public.sbom_sources%rowtype; v_baseline public.sbom_sources%rowtype; v_document uuid; v_baseline_document uuid; v_report public.sbom_diff_reports%rowtype;
begin
 select * into v_source from public.sbom_sources s where s.organization_id=p_organization_id and s.id=p_source_id and s.deduplicated_from_source_id is null for share;
 select * into v_baseline from public.sbom_sources s where s.organization_id=p_organization_id and s.id=p_baseline_source_id and s.deduplicated_from_source_id is null for share;
 if not found or v_source.release_id<>v_baseline.release_id or p_source_id=p_baseline_source_id then return query select 'not_found'::text,null::jsonb;return;end if;
 select ds.document_id into v_document from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id and d.state='completed' where ds.organization_id=p_organization_id and ds.source_id=p_source_id order by d.completed_at desc,d.id desc limit 1;
 select ds.document_id into v_baseline_document from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id and d.state='completed' where ds.organization_id=p_organization_id and ds.source_id=p_baseline_source_id order by d.completed_at desc,d.id desc limit 1;
 if v_document is null or v_baseline_document is null or v_document=v_baseline_document then return query select 'no_comparable_version'::text,null::jsonb;return;end if;
 insert into public.sbom_diff_reports(organization_id,source_id,baseline_source_id,release_id,document_id,baseline_document_id) values(p_organization_id,p_source_id,p_baseline_source_id,v_source.release_id,v_document,v_baseline_document) on conflict(organization_id,source_id,baseline_source_id,comparator_version) do nothing returning * into v_report;
 if v_report.id is null then select * into v_report from public.sbom_diff_reports where organization_id=p_organization_id and source_id=p_source_id and baseline_source_id=p_baseline_source_id and comparator_version='m4-unavailable.v1';end if;
 return query select case when v_report.state='completed' then 'completed' else 'queued' end,public.sbom_diff_report_json(p_organization_id,v_report.id);
end;$$;

create or replace function public.claim_sbom_diff_report(p_organization_id uuid,p_worker_id text,p_lease_seconds integer)
returns table(outcome text,work jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_report public.sbom_diff_reports%rowtype;
begin
 if char_length(btrim(p_worker_id)) not between 1 and 100 or p_lease_seconds not between 15 and 900 then return query select 'invalid_request'::text,null::jsonb;return;end if;
 update public.sbom_diff_reports set state='failed',progress_stage='failed',lease_owner=null,lease_expires_at=null,error_code='unexpected_failure',error_message='The diff worker lease expired.',next_attempt_at=now(),updated_at=now() where organization_id=p_organization_id and state='processing' and lease_expires_at<=now();
 select * into v_report from public.sbom_diff_reports r where r.organization_id=p_organization_id and r.state in ('queued','failed') and r.next_attempt_at<=now() and r.attempt_count<r.max_attempts order by r.created_at,r.id for update skip locked limit 1;
 if not found then return query select 'empty'::text,null::jsonb;return;end if;
 update public.sbom_diff_reports set state='processing',progress_stage='projecting_identities',progress_percent=10,attempt_count=attempt_count+1,lease_owner=btrim(p_worker_id),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),error_code=null,error_message=null,updated_at=now() where organization_id=p_organization_id and id=v_report.id returning * into v_report;
 return query select 'claimed'::text,jsonb_build_object('id',v_report.id,'sourceId',v_report.source_id,'baselineSourceId',v_report.baseline_source_id,'releaseId',v_report.release_id,'documentId',v_report.document_id,'baselineDocumentId',v_report.baseline_document_id,'comparatorVersion',v_report.comparator_version,'checkpoint',v_report.checkpoint);
end;$$;

create or replace function public.list_due_sbom_diff_organizations(p_limit integer)
returns table(organization_id uuid,oldest_due_at timestamptz) language sql security definer set search_path=public,pg_temp as $$
 select r.organization_id,min(r.next_attempt_at)
 from public.sbom_diff_reports r
 where r.state in ('queued','failed') and r.next_attempt_at<=now() and r.attempt_count<r.max_attempts
 group by r.organization_id order by min(r.next_attempt_at),r.organization_id limit greatest(0,least(p_limit,500));
$$;

create or replace function public.resolve_sbom_diff_baseline(p_organization_id uuid,p_actor_user_id uuid,p_source_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_source public.sbom_sources%rowtype;
begin
 if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb;return;end if;
 select * into v_source from public.sbom_sources s where s.organization_id=p_organization_id and s.id=p_source_id and s.deduplicated_from_source_id is null;
 if not found then return query select 'not_found'::text,null::jsonb;return;end if;
 if v_source.supersedes_source_id is null then return query select 'no_comparable_version'::text,jsonb_build_object('baselineSourceId',null);return;end if;
 if not exists(select 1 from public.sbom_sources b where b.organization_id=p_organization_id and b.id=v_source.supersedes_source_id and b.release_id=v_source.release_id and b.deduplicated_from_source_id is null) then return query select 'no_comparable_version'::text,jsonb_build_object('baselineSourceId',null);return;end if;
 return query select 'found'::text,jsonb_build_object('baselineSourceId',v_source.supersedes_source_id);
end;$$;

create or replace function public.list_sbom_diff_component_facts(p_organization_id uuid,p_report_id uuid,p_worker_id text,p_side text,p_limit integer,p_cursor text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_report public.sbom_diff_reports%rowtype;v_document_id uuid;v_cursor jsonb;v_identity text:='';v_offset bigint:=0;v_id uuid;v_rows jsonb;
begin
 if p_side not in ('current','baseline') or p_limit not between 1 and 1000 then return query select 'invalid_request'::text,null::jsonb;return;end if;
 select * into v_report from public.sbom_diff_reports r where r.organization_id=p_organization_id and r.id=p_report_id and r.state='processing' and r.lease_owner=btrim(p_worker_id) and r.lease_expires_at>now();
 if not found then return query select 'not_found'::text,null::jsonb;return;end if;
 v_document_id:=case when p_side='current' then v_report.document_id else v_report.baseline_document_id end;
 perform public.ensure_sbom_component_diff_identities_atomic(p_organization_id,v_document_id,5000);
 if nullif(p_cursor,'') is not null then begin v_cursor:=convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;v_identity:=v_cursor->>0;v_offset:=(v_cursor->>1)::bigint;v_id:=(v_cursor->>2)::uuid;if jsonb_typeof(v_cursor)<>'array' or jsonb_array_length(v_cursor)<>3 then raise exception 'invalid cursor';end if;exception when others then return query select 'invalid_request'::text,null::jsonb;return;end;end if;
 select coalesce(jsonb_agg(jsonb_build_object('componentId',x.id,'packageIdentity',x.package_identity,'canonicalPurl',x.canonical_purl,'normalizedName',x.normalized_name,'normalizedVersion',x.normalized_version,'ecosystem',x.ecosystem,'sourceOffset',x.source_offset) order by x.package_identity,x.source_offset,x.id),'[]'::jsonb) into v_rows from (select c.id,public.sbom_purl_package_identity(c.canonical_purl) package_identity,c.canonical_purl,c.normalized_name,c.normalized_version,c.ecosystem,c.source_offset from public.sbom_components c where c.organization_id=p_organization_id and c.document_id=v_document_id and c.canonical_purl is not null and (public.sbom_purl_package_identity(c.canonical_purl),c.source_offset,c.id)>(v_identity,v_offset,coalesce(v_id,'00000000-0000-0000-0000-000000000000'::uuid)) order by public.sbom_purl_package_identity(c.canonical_purl),c.source_offset,c.id limit p_limit) x;
 return query select 'found'::text,jsonb_build_object('items',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then encode(convert_to(jsonb_build_array(v_rows->(p_limit-1)->>'packageIdentity',(v_rows->(p_limit-1)->>'sourceOffset')::bigint,v_rows->(p_limit-1)->>'componentId')::text,'utf8'),'base64') else null end);
end;$$;

create or replace function public.persist_sbom_diff_batch_atomic(p_organization_id uuid,p_report_id uuid,p_worker_id text,p_changes jsonb,p_checkpoint jsonb,p_complete boolean)
returns table(outcome text,report jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if char_length(btrim(p_worker_id)) not between 1 and 100 or jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes)>1000 or octet_length(p_changes::text)>1048576 or jsonb_typeof(p_checkpoint)<>'object' or octet_length(p_checkpoint::text)>32768 then return query select 'invalid_request'::text,null::jsonb;return;end if;
 if not exists(select 1 from public.sbom_diff_reports r where r.organization_id=p_organization_id and r.id=p_report_id and r.state='processing' and r.lease_owner=btrim(p_worker_id) and r.lease_expires_at>now() for update) then return query select 'not_found'::text,null::jsonb;return;end if;
 insert into public.sbom_diff_component_changes(organization_id,report_id,change_key,change_type,canonical_package_identity,ecosystem,current_component_id,baseline_component_id,current_version,baseline_version,explanation)
 select p_organization_id,p_report_id,x.change_key,x.change_type,x.canonical_package_identity,x.ecosystem,x.current_component_id,x.baseline_component_id,x.current_version,x.baseline_version,x.explanation from jsonb_to_recordset(p_changes) as x(change_key text,change_type text,canonical_package_identity text,ecosystem text,current_component_id uuid,baseline_component_id uuid,current_version text,baseline_version text,explanation text)
 on conflict(organization_id,report_id,change_key) do update set change_type=excluded.change_type,canonical_package_identity=excluded.canonical_package_identity,ecosystem=excluded.ecosystem,current_component_id=excluded.current_component_id,baseline_component_id=excluded.baseline_component_id,current_version=excluded.current_version,baseline_version=excluded.baseline_version,explanation=excluded.explanation;
 update public.sbom_diff_reports set checkpoint=p_checkpoint,progress_change_count=(select count(*) from public.sbom_diff_component_changes where organization_id=p_organization_id and report_id=p_report_id),state=case when p_complete then 'completed' else 'processing' end,progress_stage=case when p_complete then 'completed' else 'recording_changes' end,progress_percent=case when p_complete then 100 else greatest(progress_percent,80) end,lease_owner=case when p_complete then null else lease_owner end,lease_expires_at=case when p_complete then null else lease_expires_at end,completed_at=case when p_complete then now() else null end,updated_at=now() where organization_id=p_organization_id and id=p_report_id;
 return query select case when p_complete then 'completed' else 'persisted' end,public.sbom_diff_report_json(p_organization_id,p_report_id);
end;$$;

create or replace function public.fail_sbom_diff_report(p_organization_id uuid,p_report_id uuid,p_worker_id text,p_error_code text,p_error_message text)
returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_error_code not in ('baseline_unavailable','normalized_document_missing','diff_persistence_unavailable','diff_statement_timeout','diff_calculation_failed','provider_unavailable','unexpected_failure') or char_length(btrim(coalesce(p_error_message,''))) not between 1 and 1000 then return query select 'invalid_request'::text;return;end if;
 update public.sbom_diff_reports set state='failed',progress_stage='failed',lease_owner=null,lease_expires_at=null,error_code=p_error_code,error_message=btrim(p_error_message),next_attempt_at=now(),updated_at=now() where organization_id=p_organization_id and id=p_report_id and state='processing' and lease_owner=btrim(p_worker_id) and lease_expires_at>now();
 if not found then return query select 'not_found'::text;return;end if;return query select 'failed'::text;
end;$$;

create or replace function public.retry_sbom_diff_report_atomic(p_organization_id uuid,p_actor_user_id uuid,p_report_id uuid,p_idempotency_key uuid)
returns table(outcome text,report jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_report public.sbom_diff_reports%rowtype;
begin
 if p_idempotency_key is null or not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb;return;end if;
 select * into v_report from public.sbom_diff_reports r where r.organization_id=p_organization_id and r.id=p_report_id for update;
 if not found then return query select 'not_found'::text,null::jsonb;return;end if;
 if v_report.state='completed' then return query select 'completed'::text,public.sbom_diff_report_json(p_organization_id,p_report_id);return;end if;
 update public.sbom_diff_reports set state='queued',progress_stage='queued',progress_percent=0,checkpoint='{}'::jsonb,next_attempt_at=now(),lease_owner=null,lease_expires_at=null,error_code=null,error_message=null,updated_at=now() where organization_id=p_organization_id and id=p_report_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'sbom.diff_retried','sbom_diff_report',p_report_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key));
 return query select 'queued'::text,public.sbom_diff_report_json(p_organization_id,p_report_id);
end;$$;

create or replace function public.get_sbom_diff_report(p_organization_id uuid,p_actor_user_id uuid,p_report_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or not exists(select 1 from public.sbom_diff_reports where organization_id=p_organization_id and id=p_report_id) then return query select 'not_found'::text,null::jsonb;return;end if;return query select 'found'::text,jsonb_build_object('report',public.sbom_diff_report_json(p_organization_id,p_report_id));end;$$;

create or replace function public.list_sbom_diff_component_changes(p_organization_id uuid,p_actor_user_id uuid,p_report_id uuid,p_limit integer,p_cursor text,p_change_type text,p_ecosystem text,p_q text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cursor jsonb;v_created timestamptz;v_id uuid;v_rows jsonb;
begin
 if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or p_limit not between 1 and 100 or p_change_type is not null and p_change_type not in ('added','removed','unchanged','upgraded','downgraded','unresolved') or not exists(select 1 from public.sbom_diff_reports where organization_id=p_organization_id and id=p_report_id) then return query select 'not_found'::text,null::jsonb;return;end if;
 if nullif(p_cursor,'') is not null then begin v_cursor:=convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;v_created:=(v_cursor->>0)::timestamptz;v_id:=(v_cursor->>1)::uuid;if jsonb_typeof(v_cursor)<>'array' or jsonb_array_length(v_cursor)<>2 then raise exception 'invalid cursor';end if;exception when others then return query select 'invalid_request'::text,null::jsonb;return;end;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'changeType',x.change_type,'identity',x.canonical_package_identity,'ecosystem',x.ecosystem,'currentComponentId',x.current_component_id,'baselineComponentId',x.baseline_component_id,'currentVersion',x.current_version,'baselineVersion',x.baseline_version,'explanation',x.explanation,'createdAt',x.created_at) order by x.created_at,x.id),'[]'::jsonb) into v_rows from (select c.* from public.sbom_diff_component_changes c where c.organization_id=p_organization_id and c.report_id=p_report_id and (v_cursor is null or (c.created_at,c.id)>(v_created,v_id)) and (p_change_type is null or c.change_type=p_change_type) and (p_ecosystem is null or c.ecosystem=p_ecosystem) and (nullif(btrim(p_q),'') is null or c.canonical_package_identity ilike '%'||btrim(p_q)||'%') order by c.created_at,c.id limit p_limit) x;
 return query select 'found'::text,jsonb_build_object('changes',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then public.sbom_diff_cursor_encode((v_rows->(p_limit-1)->>'createdAt')::timestamptz,(v_rows->(p_limit-1)->>'id')::uuid) else null end);
end;$$;

create or replace function public.get_sbom_diff_findings(p_organization_id uuid,p_actor_user_id uuid,p_report_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin if not public.sbom_actor_can_view(p_organization_id,p_actor_user_id) or not exists(select 1 from public.sbom_diff_reports where organization_id=p_organization_id and id=p_report_id) then return query select 'not_found'::text,null::jsonb;return;end if;return query select 'found'::text,jsonb_build_object('state','partial_integration_unavailable','items','[]'::jsonb);end;$$;

insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort) values
 ('sbom_normalized_graph','sbom_diff_reports','organization_id','id',9),('sbom_normalized_graph','sbom_diff_component_changes','organization_id','id',10)
on conflict(source_id,table_name) do update set tenant_key_column=excluded.tenant_key_column,record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;

alter function public.prevent_sbom_source_dedup_mutation() owner to postgres;
alter function public.sbom_purl_package_identity(text) owner to postgres;
alter function public.ensure_sbom_component_diff_identities_atomic(uuid,uuid,integer) owner to postgres;
alter function public.sbom_diff_cursor_encode(timestamptz,uuid) owner to postgres;
alter function public.sbom_diff_report_json(uuid,uuid) owner to postgres;
alter function public.enqueue_sbom_diff_report_atomic(uuid,uuid,uuid) owner to postgres;
alter function public.claim_sbom_diff_report(uuid,text,integer) owner to postgres;
alter function public.list_due_sbom_diff_organizations(integer) owner to postgres;
alter function public.resolve_sbom_diff_baseline(uuid,uuid,uuid) owner to postgres;
alter function public.list_sbom_diff_component_facts(uuid,uuid,text,text,integer,text) owner to postgres;
alter function public.persist_sbom_diff_batch_atomic(uuid,uuid,text,jsonb,jsonb,boolean) owner to postgres;
alter function public.fail_sbom_diff_report(uuid,uuid,text,text,text) owner to postgres;
alter function public.retry_sbom_diff_report_atomic(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.get_sbom_diff_report(uuid,uuid,uuid) owner to postgres;
alter function public.list_sbom_diff_component_changes(uuid,uuid,uuid,integer,text,text,text,text) owner to postgres;
alter function public.get_sbom_diff_findings(uuid,uuid,uuid) owner to postgres;
revoke all on function public.prevent_sbom_source_dedup_mutation(),public.sbom_purl_package_identity(text),public.ensure_sbom_component_diff_identities_atomic(uuid,uuid,integer),public.sbom_diff_cursor_encode(timestamptz,uuid),public.sbom_diff_report_json(uuid,uuid),public.enqueue_sbom_diff_report_atomic(uuid,uuid,uuid),public.claim_sbom_diff_report(uuid,text,integer),public.list_due_sbom_diff_organizations(integer),public.resolve_sbom_diff_baseline(uuid,uuid,uuid),public.list_sbom_diff_component_facts(uuid,uuid,text,text,integer,text),public.persist_sbom_diff_batch_atomic(uuid,uuid,text,jsonb,jsonb,boolean),public.fail_sbom_diff_report(uuid,uuid,text,text,text),public.retry_sbom_diff_report_atomic(uuid,uuid,uuid,uuid),public.get_sbom_diff_report(uuid,uuid,uuid),public.list_sbom_diff_component_changes(uuid,uuid,uuid,integer,text,text,text,text),public.get_sbom_diff_findings(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ensure_sbom_component_diff_identities_atomic(uuid,uuid,integer),public.enqueue_sbom_diff_report_atomic(uuid,uuid,uuid),public.claim_sbom_diff_report(uuid,text,integer),public.list_due_sbom_diff_organizations(integer),public.resolve_sbom_diff_baseline(uuid,uuid,uuid),public.list_sbom_diff_component_facts(uuid,uuid,text,text,integer,text),public.persist_sbom_diff_batch_atomic(uuid,uuid,text,jsonb,jsonb,boolean),public.fail_sbom_diff_report(uuid,uuid,text,text,text),public.retry_sbom_diff_report_atomic(uuid,uuid,uuid,uuid),public.get_sbom_diff_report(uuid,uuid,uuid),public.list_sbom_diff_component_changes(uuid,uuid,uuid,integer,text,text,text,text),public.get_sbom_diff_findings(uuid,uuid,uuid) to service_role;
