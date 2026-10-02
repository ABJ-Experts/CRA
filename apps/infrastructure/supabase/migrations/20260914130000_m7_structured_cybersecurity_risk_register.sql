-- M7-02: an append-only, product-scoped CRA cybersecurity risk register.
-- This deliberately stores manual Annex I references as unresolved: M10 owns
-- authoritative framework packs and must not be inferred here.

create table public.technical_file_risk_registers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  technical_file_id uuid not null,
  method_key text not null default 'cra_5x5_v1' check (method_key = 'cra_5x5_v1'),
  method_version text not null default '1.0' check (method_version = '1.0'),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id, id),
  unique (organization_id, technical_file_id),
  foreign key (organization_id, technical_file_id) references public.technical_files(organization_id,id) on delete restrict
);

create table public.technical_file_risks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  risk_register_id uuid not null,
  owner_user_id uuid not null references public.users(id) on delete restrict,
  current_revision integer not null default 1 check (current_revision > 0),
  version integer not null default 1 check (version > 0),
  archived_at timestamptz,
  archived_by uuid references public.users(id) on delete restrict,
  archive_rationale text check (archive_rationale is null or (archive_rationale=btrim(archive_rationale) and char_length(archive_rationale) between 1 and 4000)),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references public.users(id) on delete restrict,
  unique (organization_id,id),
  foreign key (organization_id,risk_register_id) references public.technical_file_risk_registers(organization_id,id) on delete restrict,
  check ((archived_at is null and archived_by is null and archive_rationale is null) or (archived_at is not null and archived_by is not null and archive_rationale is not null))
);

create table public.technical_file_risk_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  risk_id uuid not null,
  revision integer not null check (revision > 0),
  threat text not null check (threat = btrim(threat) and char_length(threat) between 1 and 4000),
  revision_rationale text not null check (revision_rationale=btrim(revision_rationale) and char_length(revision_rationale) between 1 and 4000),
  affected_assets_rationale text check (affected_assets_rationale is null or (affected_assets_rationale=btrim(affected_assets_rationale) and char_length(affected_assets_rationale) between 1 and 4000)),
  mitigation text not null check (mitigation=btrim(mitigation) and char_length(mitigation) between 1 and 12000),
  inherent_likelihood smallint check (inherent_likelihood between 1 and 5),
  inherent_impact smallint check (inherent_impact between 1 and 5),
  inherent_likelihood_rationale text not null check (inherent_likelihood_rationale=btrim(inherent_likelihood_rationale) and char_length(inherent_likelihood_rationale) between 1 and 4000),
  inherent_impact_rationale text not null check (inherent_impact_rationale=btrim(inherent_impact_rationale) and char_length(inherent_impact_rationale) between 1 and 4000),
  residual_likelihood smallint check (residual_likelihood between 1 and 5),
  residual_impact smallint check (residual_impact between 1 and 5),
  residual_likelihood_rationale text not null check (residual_likelihood_rationale=btrim(residual_likelihood_rationale) and char_length(residual_likelihood_rationale) between 1 and 4000),
  residual_impact_rationale text not null check (residual_impact_rationale=btrim(residual_impact_rationale) and char_length(residual_impact_rationale) between 1 and 4000),
  residual_accepted_at timestamptz,
  residual_accepted_by uuid references public.users(id) on delete restrict,
  residual_acceptance_rationale text check (residual_acceptance_rationale is null or (residual_acceptance_rationale=btrim(residual_acceptance_rationale) and char_length(residual_acceptance_rationale) between 1 and 4000)),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id), unique (risk_id,revision),
  foreign key (organization_id,risk_id) references public.technical_file_risks(organization_id,id) on delete restrict,
  check (inherent_likelihood is not null and inherent_impact is not null),
  check (residual_likelihood is not null and residual_impact is not null),
  check ((residual_accepted_at is null and residual_accepted_by is null and residual_acceptance_rationale is null) or (residual_accepted_at is not null and residual_accepted_by is not null and residual_acceptance_rationale is not null)),
  check (residual_accepted_at is null or residual_likelihood is not null)
);

create table public.technical_file_risk_revision_assets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_id uuid not null,
  component_id uuid not null,
  document_id uuid not null,
  observed_document_sha256 text not null check (observed_document_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (revision_id,component_id),
  foreign key (organization_id,revision_id) references public.technical_file_risk_revisions(organization_id,id) on delete restrict,
  foreign key (organization_id,document_id,component_id) references public.sbom_components(organization_id,document_id,id) on delete restrict
);

create table public.technical_file_risk_revision_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_id uuid not null,
  identifier text not null check (identifier=btrim(identifier) and char_length(identifier) between 1 and 200),
  edition text not null check (edition=btrim(edition) and char_length(edition) between 1 and 200),
  source_reference text not null check (source_reference=btrim(source_reference) and char_length(source_reference) between 1 and 2000),
  rationale text check (rationale is null or (rationale=btrim(rationale) and char_length(rationale) between 1 and 4000)),
  status text not null default 'unresolved' check (status = 'unresolved'),
  unique (revision_id,identifier,edition),
  foreign key (organization_id,revision_id) references public.technical_file_risk_revisions(organization_id,id) on delete restrict
);

create table public.technical_file_risk_revision_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_id uuid not null,
  evidence_kind text not null check (evidence_kind in ('manual_reference','technical_file_source')),
  source_id uuid,
  observed_revision text,
  title text not null check (title=btrim(title) and char_length(title) between 1 and 500),
  locator text check (locator is null or (locator=btrim(locator) and char_length(locator) between 1 and 2000)),
  rationale text check (rationale is null or (rationale=btrim(rationale) and char_length(rationale) between 1 and 4000)),
  unique (organization_id,id),
  foreign key (organization_id,revision_id) references public.technical_file_risk_revisions(organization_id,id) on delete restrict,
  foreign key (organization_id,source_id) references public.technical_file_section_sources(organization_id,id) on delete restrict,
  check ((evidence_kind='manual_reference' and source_id is null and observed_revision is null) or (evidence_kind='technical_file_source' and source_id is not null and observed_revision is not null))
);

create table public.technical_file_risk_commands (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  operation text not null check (operation in ('created','updated','archived','residual_accepted')),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  risk_id uuid references public.technical_file_risks(id) on delete restrict,
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,actor_user_id,idempotency_key)
);

create index technical_file_risk_registers_file_idx on public.technical_file_risk_registers(organization_id,technical_file_id);
create index technical_file_risks_register_idx on public.technical_file_risks(organization_id,risk_register_id) where archived_at is null;
create index technical_file_risk_revisions_risk_idx on public.technical_file_risk_revisions(organization_id,risk_id,revision desc);

alter table public.technical_file_risk_registers enable row level security;
alter table public.technical_file_risks enable row level security;
alter table public.technical_file_risk_revisions enable row level security;
alter table public.technical_file_risk_revision_assets enable row level security;
alter table public.technical_file_risk_revision_requirements enable row level security;
alter table public.technical_file_risk_revision_evidence enable row level security;
alter table public.technical_file_risk_commands enable row level security;
revoke all on table public.technical_file_risk_registers,public.technical_file_risks,public.technical_file_risk_revisions,public.technical_file_risk_revision_assets,public.technical_file_risk_revision_requirements,public.technical_file_risk_revision_evidence,public.technical_file_risk_commands from public,anon,authenticated;
grant all on table public.technical_file_risk_registers,public.technical_file_risks,public.technical_file_risk_revisions,public.technical_file_risk_revision_assets,public.technical_file_risk_revision_requirements,public.technical_file_risk_revision_evidence,public.technical_file_risk_commands to service_role;

create or replace function public.m7_risk_level(p_likelihood smallint,p_impact smallint)
returns text language sql immutable strict set search_path=public,pg_temp as $$
  select case when p_likelihood*p_impact <= 4 then 'low' when p_likelihood*p_impact <= 9 then 'medium' when p_likelihood*p_impact <= 16 then 'high' else 'critical' end
$$;

create or replace function public.m7_risk_actor_can_accept(p_organization_id uuid,p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active join public.organizations o on o.id=m.organization_id and o.is_active where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role in ('owner','admin'))
$$;

create or replace function public.m7_risk_register_json(p_organization_id uuid,p_product_id uuid,p_include_archived boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',rr.id,'organizationId',rr.organization_id,'productId',p_product_id,'technicalFileId',rr.technical_file_id,'methodKey',rr.method_key,'methodVersion','1','version',rr.version,'risks',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'organizationId',r.organization_id,'productId',p_product_id,'registerId',r.risk_register_id,'version',r.version,'status',case when r.archived_at is not null then 'archived' when rv.residual_accepted_at is null then 'review_required' else 'assessed' end,'archivedAt',r.archived_at,'archivedByUserId',r.archived_by,'archiveRationale',r.archive_rationale,'residualRiskAcceptance',case when rv.residual_accepted_at is null then null else jsonb_build_object('acceptedAt',to_char(rv.residual_accepted_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'acceptedByUserId',rv.residual_accepted_by,'rationale',rv.residual_acceptance_rationale,'revision',rv.revision) end,'currentRevision',jsonb_build_object('id',rv.id,'revision',rv.revision,'threat',rv.threat,'affectedAssets',coalesce((select jsonb_agg(jsonb_build_object('id',a.component_id,'componentId',a.component_id,'componentName',c.normalized_name,'componentVersion',c.normalized_version,'sbomDocumentId',a.document_id,'observedRevision',a.observed_document_sha256,'status',case when d.state='completed' and d.document_sha256=a.observed_document_sha256 then 'current' else 'review_required' end) order by a.component_id) from public.technical_file_risk_revision_assets a join public.sbom_components c on c.organization_id=a.organization_id and c.id=a.component_id join public.sbom_documents d on d.organization_id=a.organization_id and d.id=a.document_id where a.organization_id=rv.organization_id and a.revision_id=rv.id),'[]'::jsonb),'requirements',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'identifier',q.identifier,'edition',q.edition,'sourceReference',q.source_reference,'rationale',q.rationale,'status',q.status) order by q.identifier,q.edition) from public.technical_file_risk_revision_requirements q where q.organization_id=rv.organization_id and q.revision_id=rv.id),'[]'::jsonb),'inherentAssessment',jsonb_build_object('likelihood',rv.inherent_likelihood,'impact',rv.inherent_impact,'likelihoodRationale',rv.inherent_likelihood_rationale,'impactRationale',rv.inherent_impact_rationale,'level',public.m7_risk_level(rv.inherent_likelihood,rv.inherent_impact)),'mitigations',rv.mitigation,'residualAssessment',jsonb_build_object('likelihood',rv.residual_likelihood,'impact',rv.residual_impact,'likelihoodRationale',rv.residual_likelihood_rationale,'impactRationale',rv.residual_impact_rationale,'level',public.m7_risk_level(rv.residual_likelihood,rv.residual_impact)),'revisionRationale',rv.revision_rationale,'ownerId',r.owner_user_id,'evidenceReferences',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'recordId',e.source_id,'observedRevision',e.observed_revision,'locator',e.locator,'rationale',e.rationale,'status',case when e.evidence_kind='manual_reference' then 'current' when exists(select 1 from public.technical_file_section_sources s where s.organization_id=e.organization_id and s.id=e.source_id and s.observed_revision=e.observed_revision) then 'current' when exists(select 1 from public.technical_file_section_sources s where s.organization_id=e.organization_id and s.id=e.source_id) then 'review_required' else 'unavailable' end) order by e.id) from public.technical_file_risk_revision_evidence e where e.organization_id=rv.organization_id and e.revision_id=rv.id),'[]'::jsonb),'createdByUserId',rv.created_by,'createdAt',to_char(rv.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by r.created_at,r.id) from public.technical_file_risks r join public.technical_file_risk_revisions rv on rv.organization_id=r.organization_id and rv.risk_id=r.id and rv.revision=r.current_revision where r.organization_id=rr.organization_id and r.risk_register_id=rr.id and (p_include_archived or r.archived_at is null)),'[]'::jsonb),'createdAt',to_char(rr.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'updatedAt',to_char(rr.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) from public.technical_file_risk_registers rr join public.technical_files tf on tf.organization_id=rr.organization_id and tf.id=rr.technical_file_id where rr.organization_id=p_organization_id and tf.product_id=p_product_id and tf.status='active'
$$;

create or replace function public.m7_risk_command_replay(p_organization_id uuid,p_actor_user_id uuid,p_idempotency_key uuid,p_operation text,p_payload_digest text)
returns table(outcome text,result jsonb) language sql stable security definer set search_path=public,pg_temp as $$
 select case when c.operation=p_operation and c.payload_digest=p_payload_digest then 'replayed' else 'idempotency_conflict' end,c.result from public.technical_file_risk_commands c where c.organization_id=p_organization_id and c.actor_user_id=p_actor_user_id and c.idempotency_key=p_idempotency_key
$$;

create or replace function public.m7_risk_insert_links(p_organization_id uuid,p_product_id uuid,p_revision_id uuid,p_assets jsonb,p_requirements jsonb,p_evidence jsonb)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item jsonb; v_component uuid; v_document uuid; v_hash text; v_source uuid; v_revision text;
begin
 if jsonb_typeof(coalesce(p_assets,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_assets,'[]'::jsonb))>100 or jsonb_typeof(coalesce(p_requirements,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_requirements,'[]'::jsonb))>100 or jsonb_typeof(coalesce(p_evidence,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_evidence,'[]'::jsonb))>100 then return 'invalid_request'; end if;
 for v_item in select value from jsonb_array_elements(coalesce(p_assets,'[]'::jsonb)) loop
   begin v_component := (v_item->>'componentId')::uuid; exception when invalid_text_representation then return 'invalid_request'; end;
   select c.document_id,d.document_sha256 into v_document,v_hash from public.sbom_components c join public.sbom_documents d on d.organization_id=c.organization_id and d.id=c.document_id where c.organization_id=p_organization_id and c.id=v_component and d.state='completed' and exists(select 1 from public.sbom_document_sources ds join public.product_releases pr on pr.organization_id=ds.organization_id and pr.id=ds.release_id where ds.organization_id=d.organization_id and ds.document_id=d.id and pr.product_id=p_product_id and pr.archived_at is null) limit 1;
   if v_document is null then return 'not_found'; end if;
   insert into public.technical_file_risk_revision_assets(organization_id,revision_id,component_id,document_id,observed_document_sha256) values(p_organization_id,p_revision_id,v_component,v_document,v_hash);
 end loop;
 for v_item in select value from jsonb_array_elements(coalesce(p_requirements,'[]'::jsonb)) loop
   if jsonb_typeof(v_item)<>'object' or char_length(btrim(coalesce(v_item->>'identifier',''))) not between 1 and 200 or char_length(btrim(coalesce(v_item->>'edition',''))) not between 1 and 200 or char_length(btrim(coalesce(v_item->>'sourceReference',''))) not between 1 and 2000 or char_length(btrim(coalesce(v_item->>'rationale',''))) not between 1 and 4000 then return 'invalid_request'; end if;
   insert into public.technical_file_risk_revision_requirements(organization_id,revision_id,identifier,edition,source_reference,rationale) values(p_organization_id,p_revision_id,btrim(v_item->>'identifier'),btrim(v_item->>'edition'),btrim(v_item->>'sourceReference'),btrim(v_item->>'rationale'));
 end loop;
 for v_item in select value from jsonb_array_elements(coalesce(p_evidence,'[]'::jsonb)) loop
   if jsonb_typeof(v_item)<>'object' or char_length(btrim(coalesce(v_item->>'title',''))) not between 1 and 500 or char_length(btrim(coalesce(v_item->>'rationale',''))) not between 1 and 4000 then return 'invalid_request'; end if;
   if v_item->>'recordId' is null then
     if v_item->>'observedRevision' is not null then return 'invalid_request'; end if;
     insert into public.technical_file_risk_revision_evidence(organization_id,revision_id,evidence_kind,title,locator,rationale) values(p_organization_id,p_revision_id,'manual_reference',btrim(v_item->>'title'),nullif(btrim(coalesce(v_item->>'locator','')),''),btrim(v_item->>'rationale'));
   else
     begin v_source := (v_item->>'recordId')::uuid; exception when invalid_text_representation then return 'invalid_request'; end;
     select s.observed_revision into v_revision from public.technical_file_section_sources s join public.technical_file_sections sec on sec.organization_id=s.organization_id and sec.id=s.section_id join public.technical_files tf on tf.organization_id=sec.organization_id and tf.id=sec.technical_file_id where s.organization_id=p_organization_id and s.id=v_source and tf.product_id=p_product_id and tf.status='active';
     if v_revision is null or v_revision is distinct from v_item->>'observedRevision' then return 'not_found'; end if;
     insert into public.technical_file_risk_revision_evidence(organization_id,revision_id,evidence_kind,source_id,observed_revision,title,locator,rationale) values(p_organization_id,p_revision_id,'technical_file_source',v_source,v_revision,btrim(v_item->>'title'),nullif(btrim(coalesce(v_item->>'locator','')),''),btrim(v_item->>'rationale'));
   end if;
 end loop;
 return 'ok';
end $$;

create or replace function public.get_technical_file_risk_register(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 if not exists(select 1 from public.technical_files tf where tf.organization_id=p_organization_id and tf.product_id=p_product_id and tf.status='active') then return query select 'not_found'::text,null::jsonb; return; end if;
 return query select case when x.value is null then 'not_found' else 'found' end,case when x.value is null then null else jsonb_build_object('riskRegister',x.value) end from (select public.m7_risk_register_json(p_organization_id,p_product_id,false) value) x;
end $$;

create or replace function public.create_technical_file_risk_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_payload jsonb,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_file public.technical_files%rowtype; v_register public.technical_file_risk_registers%rowtype; v_risk public.technical_file_risks%rowtype; v_revision public.technical_file_risk_revisions%rowtype; v_owner uuid; v_links text; v_digest text; v_replay record; v_inherent_l smallint; v_inherent_i smallint; v_residual_l smallint; v_residual_i smallint;
begin
 if p_idempotency_key is null or jsonb_typeof(p_payload)<>'object' then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('operation','created','productId',p_product_id,'payload',p_payload)::text,'sha256'),'hex');
 select * into v_replay from public.m7_risk_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'created',v_digest); if found then return query select v_replay.outcome,v_replay.result; return; end if;
 select * into v_file from public.technical_files tf where tf.organization_id=p_organization_id and tf.product_id=p_product_id and tf.status='active'; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_file.id::text,0));
 insert into public.technical_file_risk_registers(organization_id,technical_file_id,created_by,updated_by) values(p_organization_id,v_file.id,p_actor_user_id,p_actor_user_id) on conflict(organization_id,technical_file_id) do update set updated_at=public.technical_file_risk_registers.updated_at returning * into v_register;
 begin v_owner:=coalesce((p_payload->>'ownerId')::uuid,p_actor_user_id); exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end;
 if not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=v_owner) then return query select 'not_found'::text,null::jsonb; return; end if;
 begin v_inherent_l:=(p_payload->'inherentAssessment'->>'likelihood')::smallint; v_inherent_i:=(p_payload->'inherentAssessment'->>'impact')::smallint; v_residual_l:=(p_payload->'residualAssessment'->>'likelihood')::smallint; v_residual_i:=(p_payload->'residualAssessment'->>'impact')::smallint; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end;
 if char_length(btrim(coalesce(p_payload->>'threat',''))) not between 1 and 4000 or char_length(btrim(coalesce(p_payload->>'mitigations',''))) not between 1 and 12000 or char_length(btrim(coalesce(p_payload->>'revisionRationale',''))) not between 1 and 4000 or v_inherent_l not between 1 and 5 or v_inherent_i not between 1 and 5 or v_residual_l not between 1 and 5 or v_residual_i not between 1 and 5 or char_length(btrim(coalesce(p_payload->'inherentAssessment'->>'likelihoodRationale',''))) not between 1 and 4000 or char_length(btrim(coalesce(p_payload->'inherentAssessment'->>'impactRationale',''))) not between 1 and 4000 or char_length(btrim(coalesce(p_payload->'residualAssessment'->>'likelihoodRationale',''))) not between 1 and 4000 or char_length(btrim(coalesce(p_payload->'residualAssessment'->>'impactRationale',''))) not between 1 and 4000 then return query select 'invalid_request'::text,null::jsonb; return; end if;
 insert into public.technical_file_risks(organization_id,risk_register_id,owner_user_id,created_by,updated_by) values(p_organization_id,v_register.id,v_owner,p_actor_user_id,p_actor_user_id) returning * into v_risk;
 insert into public.technical_file_risk_revisions(organization_id,risk_id,revision,threat,revision_rationale,mitigation,inherent_likelihood,inherent_impact,inherent_likelihood_rationale,inherent_impact_rationale,residual_likelihood,residual_impact,residual_likelihood_rationale,residual_impact_rationale,created_by) values(p_organization_id,v_risk.id,1,btrim(p_payload->>'threat'),btrim(p_payload->>'revisionRationale'),btrim(p_payload->>'mitigations'),v_inherent_l,v_inherent_i,btrim(p_payload->'inherentAssessment'->>'likelihoodRationale'),btrim(p_payload->'inherentAssessment'->>'impactRationale'),v_residual_l,v_residual_i,btrim(p_payload->'residualAssessment'->>'likelihoodRationale'),btrim(p_payload->'residualAssessment'->>'impactRationale'),p_actor_user_id) returning * into v_revision;
 v_links:=public.m7_risk_insert_links(p_organization_id,p_product_id,v_revision.id,p_payload->'affectedAssets',p_payload->'requirements',p_payload->'evidenceReferences'); if v_links<>'ok' then return query select v_links,null::jsonb; return; end if;
 update public.technical_file_risk_registers set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where id=v_register.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.risk_created','technical_file_risk',v_risk.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',v_digest,'revisionId',v_revision.id));
 insert into public.technical_file_risk_commands(organization_id,actor_user_id,idempotency_key,operation,payload_digest,risk_id,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'created',v_digest,v_risk.id,jsonb_build_object('risk',public.m7_risk_json(p_organization_id,p_product_id,v_risk.id)));
 return query select 'created'::text,jsonb_build_object('risk',public.m7_risk_json(p_organization_id,p_product_id,v_risk.id));
end $$;

create or replace function public.update_technical_file_risk_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_risk_id uuid,p_expected_version integer,p_payload jsonb,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_risk public.technical_file_risks%rowtype; v_revision public.technical_file_risk_revisions%rowtype; v_owner uuid; v_links text; v_digest text; v_replay record; v_inherent_l smallint; v_inherent_i smallint; v_residual_l smallint; v_residual_i smallint;
begin
 if p_expected_version<1 or p_idempotency_key is null or jsonb_typeof(p_payload)<>'object' then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('operation','updated','productId',p_product_id,'riskId',p_risk_id,'expectedVersion',p_expected_version,'payload',p_payload)::text,'sha256'),'hex'); select * into v_replay from public.m7_risk_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'updated',v_digest); if found then return query select v_replay.outcome,v_replay.result; return; end if;
 select r.* into v_risk from public.technical_file_risks r join public.technical_file_risk_registers rr on rr.organization_id=r.organization_id and rr.id=r.risk_register_id join public.technical_files tf on tf.organization_id=rr.organization_id and tf.id=rr.technical_file_id where r.organization_id=p_organization_id and r.id=p_risk_id and r.archived_at is null and tf.product_id=p_product_id and tf.status='active' for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_risk.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('register',public.m7_risk_register_json(p_organization_id,p_product_id,false)); return; end if;
 begin v_owner:=(p_payload->>'ownerId')::uuid; v_inherent_l:=(p_payload->'inherentAssessment'->>'likelihood')::smallint; v_inherent_i:=(p_payload->'inherentAssessment'->>'impact')::smallint; v_residual_l:=(p_payload->'residualAssessment'->>'likelihood')::smallint; v_residual_i:=(p_payload->'residualAssessment'->>'impact')::smallint; exception when invalid_text_representation then return query select 'invalid_request'::text,null::jsonb; return; end; if not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=v_owner) or char_length(btrim(coalesce(p_payload->>'threat',''))) not between 1 and 4000 or char_length(btrim(coalesce(p_payload->>'mitigations',''))) not between 1 and 12000 or char_length(btrim(coalesce(p_payload->>'revisionRationale',''))) not between 1 and 4000 or v_inherent_l not between 1 and 5 or v_inherent_i not between 1 and 5 or v_residual_l not between 1 and 5 or v_residual_i not between 1 and 5 or char_length(btrim(coalesce(p_payload->'inherentAssessment'->>'likelihoodRationale',''))) not between 1 and 4000 or char_length(btrim(coalesce(p_payload->'inherentAssessment'->>'impactRationale',''))) not between 1 and 4000 or char_length(btrim(coalesce(p_payload->'residualAssessment'->>'likelihoodRationale',''))) not between 1 and 4000 or char_length(btrim(coalesce(p_payload->'residualAssessment'->>'impactRationale',''))) not between 1 and 4000 then return query select 'invalid_request'::text,null::jsonb; return; end if;
 insert into public.technical_file_risk_revisions(organization_id,risk_id,revision,threat,revision_rationale,mitigation,inherent_likelihood,inherent_impact,inherent_likelihood_rationale,inherent_impact_rationale,residual_likelihood,residual_impact,residual_likelihood_rationale,residual_impact_rationale,created_by) values(p_organization_id,v_risk.id,v_risk.current_revision+1,btrim(p_payload->>'threat'),btrim(p_payload->>'revisionRationale'),btrim(p_payload->>'mitigations'),v_inherent_l,v_inherent_i,btrim(p_payload->'inherentAssessment'->>'likelihoodRationale'),btrim(p_payload->'inherentAssessment'->>'impactRationale'),v_residual_l,v_residual_i,btrim(p_payload->'residualAssessment'->>'likelihoodRationale'),btrim(p_payload->'residualAssessment'->>'impactRationale'),p_actor_user_id) returning * into v_revision; v_links:=public.m7_risk_insert_links(p_organization_id,p_product_id,v_revision.id,p_payload->'affectedAssets',p_payload->'requirements',p_payload->'evidenceReferences'); if v_links<>'ok' then return query select v_links,null::jsonb; return; end if;
 update public.technical_file_risks set owner_user_id=v_owner,current_revision=v_revision.revision,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where id=v_risk.id returning * into v_risk; update public.technical_file_risk_registers set version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where organization_id=p_organization_id and id=v_risk.risk_register_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.risk_updated','technical_file_risk',v_risk.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',v_digest,'revisionId',v_revision.id)); insert into public.technical_file_risk_commands(organization_id,actor_user_id,idempotency_key,operation,payload_digest,risk_id,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'updated',v_digest,v_risk.id,jsonb_build_object('risk',public.m7_risk_json(p_organization_id,p_product_id,v_risk.id)));
 return query select 'updated'::text,jsonb_build_object('risk',public.m7_risk_json(p_organization_id,p_product_id,v_risk.id));
end $$;

create or replace function public.accept_technical_file_residual_risk_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_risk_id uuid,p_expected_version integer,p_acceptance_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_risk public.technical_file_risks%rowtype; v_previous public.technical_file_risk_revisions%rowtype; v_revision public.technical_file_risk_revisions%rowtype; v_digest text; v_replay record;
begin
 if p_expected_version<1 or p_idempotency_key is null or char_length(btrim(coalesce(p_acceptance_rationale,''))) not between 1 and 4000 then return query select 'invalid_request'::text,null::jsonb; return; end if; if not public.m7_risk_actor_can_accept(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if; v_digest:=encode(extensions.digest(jsonb_build_object('operation','residual_accepted','productId',p_product_id,'riskId',p_risk_id,'expectedVersion',p_expected_version,'rationale',btrim(p_acceptance_rationale))::text,'sha256'),'hex'); select * into v_replay from public.m7_risk_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'residual_accepted',v_digest); if found then return query select v_replay.outcome,v_replay.result; return; end if;
 select r.* into v_risk from public.technical_file_risks r join public.technical_file_risk_registers rr on rr.organization_id=r.organization_id and rr.id=r.risk_register_id join public.technical_files tf on tf.organization_id=rr.organization_id and tf.id=rr.technical_file_id where r.organization_id=p_organization_id and r.id=p_risk_id and r.archived_at is null and tf.product_id=p_product_id and tf.status='active' for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_risk.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('register',public.m7_risk_register_json(p_organization_id,p_product_id,false)); return; end if; select * into v_previous from public.technical_file_risk_revisions where organization_id=p_organization_id and risk_id=v_risk.id and revision=v_risk.current_revision; if v_previous.residual_likelihood is null or v_previous.residual_accepted_at is not null then return query select 'invalid_request'::text,null::jsonb; return; end if;
 insert into public.technical_file_risk_revisions(organization_id,risk_id,revision,threat,revision_rationale,affected_assets_rationale,mitigation,inherent_likelihood,inherent_impact,inherent_likelihood_rationale,inherent_impact_rationale,residual_likelihood,residual_impact,residual_likelihood_rationale,residual_impact_rationale,residual_accepted_at,residual_accepted_by,residual_acceptance_rationale,created_by) select organization_id,risk_id,revision+1,threat,revision_rationale,affected_assets_rationale,mitigation,inherent_likelihood,inherent_impact,inherent_likelihood_rationale,inherent_impact_rationale,residual_likelihood,residual_impact,residual_likelihood_rationale,residual_impact_rationale,clock_timestamp(),p_actor_user_id,btrim(p_acceptance_rationale),p_actor_user_id from public.technical_file_risk_revisions where id=v_previous.id returning * into v_revision; insert into public.technical_file_risk_revision_assets select p_organization_id,v_revision.id,component_id,document_id,observed_document_sha256 from public.technical_file_risk_revision_assets where organization_id=p_organization_id and revision_id=v_previous.id; insert into public.technical_file_risk_revision_requirements(organization_id,revision_id,identifier,edition,source_reference,rationale,status) select p_organization_id,v_revision.id,identifier,edition,source_reference,rationale,status from public.technical_file_risk_revision_requirements where organization_id=p_organization_id and revision_id=v_previous.id; insert into public.technical_file_risk_revision_evidence(organization_id,revision_id,evidence_kind,source_id,observed_revision,title,locator,rationale) select p_organization_id,v_revision.id,evidence_kind,source_id,observed_revision,title,locator,rationale from public.technical_file_risk_revision_evidence where organization_id=p_organization_id and revision_id=v_previous.id;
 update public.technical_file_risks set current_revision=v_revision.revision,version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where id=v_risk.id returning * into v_risk; insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.risk_residual_accepted','technical_file_risk',v_risk.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',v_digest,'revisionId',v_revision.id)); insert into public.technical_file_risk_commands(organization_id,actor_user_id,idempotency_key,operation,payload_digest,risk_id,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'residual_accepted',v_digest,v_risk.id,jsonb_build_object('risk',public.m7_risk_json(p_organization_id,p_product_id,v_risk.id))); return query select 'accepted'::text,jsonb_build_object('risk',public.m7_risk_json(p_organization_id,p_product_id,v_risk.id));
end $$;

revoke all on function public.m7_risk_level(smallint,smallint),public.m7_risk_actor_can_accept(uuid,uuid),public.m7_risk_register_json(uuid,uuid,boolean),public.m7_risk_command_replay(uuid,uuid,uuid,text,text),public.m7_risk_insert_links(uuid,uuid,uuid,jsonb,jsonb,jsonb),public.get_technical_file_risk_register(uuid,uuid,uuid),public.create_technical_file_risk_atomic(uuid,uuid,uuid,jsonb,uuid),public.update_technical_file_risk_atomic(uuid,uuid,uuid,uuid,integer,jsonb,uuid),public.accept_technical_file_residual_risk_atomic(uuid,uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
alter function public.m7_risk_level(smallint,smallint) owner to postgres;
alter function public.m7_risk_actor_can_accept(uuid,uuid) owner to postgres;
alter function public.m7_risk_register_json(uuid,uuid,boolean) owner to postgres;
alter function public.m7_risk_command_replay(uuid,uuid,uuid,text,text) owner to postgres;
alter function public.m7_risk_insert_links(uuid,uuid,uuid,jsonb,jsonb,jsonb) owner to postgres;
alter function public.get_technical_file_risk_register(uuid,uuid,uuid) owner to postgres;
alter function public.create_technical_file_risk_atomic(uuid,uuid,uuid,jsonb,uuid) owner to postgres;
alter function public.update_technical_file_risk_atomic(uuid,uuid,uuid,uuid,integer,jsonb,uuid) owner to postgres;
alter function public.accept_technical_file_residual_risk_atomic(uuid,uuid,uuid,uuid,integer,text,uuid) owner to postgres;
grant execute on function public.get_technical_file_risk_register(uuid,uuid,uuid),public.create_technical_file_risk_atomic(uuid,uuid,uuid,jsonb,uuid),public.update_technical_file_risk_atomic(uuid,uuid,uuid,uuid,integer,jsonb,uuid),public.accept_technical_file_residual_risk_atomic(uuid,uuid,uuid,uuid,integer,text,uuid) to service_role;

notify pgrst, 'reload schema';

-- Contract-shaped per-risk result shared by mutators. Keep it as a projection
-- so the persisted revision ledger remains the single source of truth.
create or replace function public.m7_risk_json(p_organization_id uuid,p_product_id uuid,p_risk_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select value from jsonb_array_elements(coalesce(public.m7_risk_register_json(p_organization_id,p_product_id,true)->'risks','[]'::jsonb)) value where value->>'id'=p_risk_id::text
$$;

create or replace function public.archive_technical_file_risk_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_risk_id uuid,p_expected_version integer,p_archive_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_risk public.technical_file_risks%rowtype; v_digest text; v_replay record;
begin
 if p_expected_version<1 or p_idempotency_key is null or char_length(btrim(coalesce(p_archive_rationale,''))) not between 1 and 4000 then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_edit_technical_files') then return query select 'forbidden'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('operation','archived','productId',p_product_id,'riskId',p_risk_id,'expectedVersion',p_expected_version,'rationale',btrim(p_archive_rationale))::text,'sha256'),'hex');
 select * into v_replay from public.m7_risk_command_replay(p_organization_id,p_actor_user_id,p_idempotency_key,'archived',v_digest); if found then return query select v_replay.outcome,v_replay.result; return; end if;
 select r.* into v_risk from public.technical_file_risks r join public.technical_file_risk_registers rr on rr.organization_id=r.organization_id and rr.id=r.risk_register_id join public.technical_files tf on tf.organization_id=rr.organization_id and tf.id=rr.technical_file_id where r.organization_id=p_organization_id and r.id=p_risk_id and r.archived_at is null and tf.product_id=p_product_id and tf.status='active' for update;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_risk.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('currentVersion',v_risk.version); return; end if;
 update public.technical_file_risks set archived_at=clock_timestamp(),archived_by=p_actor_user_id,archive_rationale=btrim(p_archive_rationale),version=version+1,updated_at=clock_timestamp(),updated_by=p_actor_user_id where id=v_risk.id returning * into v_risk;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.risk_archived','technical_file_risk',v_risk.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',v_digest));
 insert into public.technical_file_risk_commands(organization_id,actor_user_id,idempotency_key,operation,payload_digest,risk_id,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'archived',v_digest,v_risk.id,jsonb_build_object('risk',public.m7_risk_json(p_organization_id,p_product_id,v_risk.id)));
 return query select 'archived'::text,jsonb_build_object('risk',public.m7_risk_json(p_organization_id,p_product_id,v_risk.id));
end $$;
revoke all on function public.m7_risk_json(uuid,uuid,uuid),public.archive_technical_file_risk_atomic(uuid,uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
alter function public.m7_risk_json(uuid,uuid,uuid) owner to postgres;
alter function public.archive_technical_file_risk_atomic(uuid,uuid,uuid,uuid,integer,text,uuid) owner to postgres;
grant execute on function public.archive_technical_file_risk_atomic(uuid,uuid,uuid,uuid,integer,text,uuid) to service_role;
notify pgrst, 'reload schema';
