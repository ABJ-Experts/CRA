-- M7-05: versioned EU declarations of conformity.  A declaration is a new
-- immutable legal artifact; it deliberately does not reuse snapshot exports.

create table public.technical_file_declaration_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null check (template_key=btrim(template_key) and char_length(template_key) between 1 and 100),
  template_version text not null check (template_version=btrim(template_version) and char_length(template_version) between 1 and 100),
  regulation_reference text not null check (regulation_reference=btrim(regulation_reference) and char_length(regulation_reference) between 1 and 500),
  mandatory_field_keys jsonb not null check (jsonb_typeof(mandatory_field_keys)='array'),
  content jsonb not null check (jsonb_typeof(content)='object'),
  created_at timestamptz not null default clock_timestamp(),
  unique (template_key,template_version)
);

insert into public.technical_file_declaration_templates(template_key,template_version,regulation_reference,mandatory_field_keys,content)
values (
  'cra-annex-v-eu-declaration-of-conformity','2024-11-20',
  'Regulation (EU) 2024/2847, Annex V',
  '["manufacturer","product","soleResponsibility","conformityStatement","standardsOrSpecifications","signatory","issuePlace","issueDate"]'::jsonb,
  '{"title":"EU Declaration of Conformity","signatureNotice":"The named signatory is a responsible natural person. This record is not a cryptographic or qualified electronic signature.","source":"Regulation (EU) 2024/2847, Annex V"}'::jsonb
);

create table public.technical_file_declarations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  snapshot_id uuid not null,
  template_id uuid not null references public.technical_file_declaration_templates(id) on delete restrict,
  declaration_version integer not null check (declaration_version > 0),
  draft_version integer not null default 1 check (draft_version > 0),
  status text not null default 'draft' check (status in ('draft','prepared','generating','issued','failed','superseded')),
  signatory_user_id uuid not null references public.users(id) on delete restrict,
  signatory_name text not null check (signatory_name=btrim(signatory_name) and char_length(signatory_name) between 1 and 300),
  signatory_capacity text not null check (signatory_capacity=btrim(signatory_capacity) and char_length(signatory_capacity) between 1 and 300),
  issue_place text not null check (issue_place=btrim(issue_place) and char_length(issue_place) between 1 and 300),
  signatory_place text,
  assessment_route text check (assessment_route is null or assessment_route in ('internal_control','eu_type_examination','full_quality_assurance')),
  notified_body_identifier text check (notified_body_identifier is null or (notified_body_identifier=btrim(notified_body_identifier) and char_length(notified_body_identifier) between 1 and 100)),
  notified_body jsonb,
  certificate_references jsonb not null default '[]'::jsonb check (jsonb_typeof(certificate_references)='array'),
  source_provenance jsonb not null default '[]'::jsonb check (jsonb_typeof(source_provenance)='array'),
  missing_facts jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_facts)='array'),
  reissue_reason text check (reissue_reason is null or (reissue_reason=btrim(reissue_reason) and char_length(reissue_reason) between 1 and 2000)),
  supersedes_declaration_id uuid,
  superseded_by_declaration_id uuid,
  preview_digest text check (preview_digest is null or preview_digest ~ '^[a-f0-9]{64}$'),
  snapshot_sha256 text check (snapshot_sha256 is null or snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  immutable_payload jsonb check (immutable_payload is null or jsonb_typeof(immutable_payload)='object'),
  immutable_payload_sha256 text check (immutable_payload_sha256 is null or immutable_payload_sha256 ~ '^[a-f0-9]{64}$'),
  pdf_object_path text check (pdf_object_path is null or (pdf_object_path !~ '(^|/)\\.\\.(/|$)' and pdf_object_path !~ '^/')),
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[a-f0-9]{64}$'),
  pdf_bytes bigint check (pdf_bytes is null or pdf_bytes between 1 and 26214400),
  failure_code text check (failure_code is null or failure_code in ('storage_unavailable','renderer_unavailable','source_unavailable','unknown')),
  lease_owner uuid,
  lease_expires_at timestamptz,
  idempotency_key uuid not null,
  command_digest text not null check (command_digest ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,product_id,declaration_version),
  unique (organization_id,signatory_user_id,idempotency_key),
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict,
  foreign key (organization_id,snapshot_id) references public.technical_file_snapshots(organization_id,id) on delete restrict,
  foreign key (organization_id,supersedes_declaration_id) references public.technical_file_declarations(organization_id,id) on delete restrict,
  foreign key (organization_id,superseded_by_declaration_id) references public.technical_file_declarations(organization_id,id) on delete restrict,
  check ((assessment_route in ('eu_type_examination','full_quality_assurance') and notified_body_identifier is not null and jsonb_array_length(certificate_references)>0) or (assessment_route='internal_control' and notified_body_identifier is null and jsonb_array_length(certificate_references)=0) or (assessment_route is null and notified_body_identifier is null and jsonb_array_length(certificate_references)=0)),
  check ((status in ('prepared','generating','issued','superseded') and preview_digest is not null and snapshot_sha256 is not null and immutable_payload is not null and immutable_payload_sha256 is not null) or status in ('draft','failed')),
  check ((status='issued' and pdf_object_path is not null and pdf_sha256 is not null and pdf_bytes is not null and issued_at is not null) or status<>'issued'),
  check ((status='generating' and lease_owner is not null and lease_expires_at is not null) or status<>'generating'),
  check ((status='superseded') = (superseded_by_declaration_id is not null)),
  check ((supersedes_declaration_id is null) = (reissue_reason is null))
);

create unique index technical_file_declarations_current_issued_idx
  on public.technical_file_declarations(organization_id,product_id) where status='issued';
create index technical_file_declarations_product_idx
  on public.technical_file_declarations(organization_id,product_id,created_at desc);
create index technical_file_declarations_worker_idx
  on public.technical_file_declarations(status,created_at) where status in ('prepared','generating');

create or replace function public.m7_reject_technical_file_declaration_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
declare successor public.technical_file_declarations%rowtype;
begin
  if old.status in ('issued','superseded') then
    if new.organization_id is distinct from old.organization_id or new.product_id is distinct from old.product_id
      or new.snapshot_id is distinct from old.snapshot_id or new.template_id is distinct from old.template_id
      or new.declaration_version is distinct from old.declaration_version or new.signatory_user_id is distinct from old.signatory_user_id
      or new.signatory_name is distinct from old.signatory_name or new.signatory_capacity is distinct from old.signatory_capacity
      or new.issue_place is distinct from old.issue_place or new.assessment_route is distinct from old.assessment_route
      or new.notified_body_identifier is distinct from old.notified_body_identifier or new.certificate_references is distinct from old.certificate_references
      or new.reissue_reason is distinct from old.reissue_reason or new.supersedes_declaration_id is distinct from old.supersedes_declaration_id
      or new.preview_digest is distinct from old.preview_digest or new.snapshot_sha256 is distinct from old.snapshot_sha256
      or new.immutable_payload is distinct from old.immutable_payload or new.immutable_payload_sha256 is distinct from old.immutable_payload_sha256
      or new.pdf_object_path is distinct from old.pdf_object_path or new.pdf_sha256 is distinct from old.pdf_sha256 or new.pdf_bytes is distinct from old.pdf_bytes
      or new.issued_at is distinct from old.issued_at then
      raise exception 'issued declaration payload is immutable';
    end if;
    if old.status='issued' and new.status='superseded' and new.superseded_by_declaration_id is not null then
      select * into successor from public.technical_file_declarations where organization_id=old.organization_id and id=new.superseded_by_declaration_id for key share;
      if not found or successor.product_id<>old.product_id or successor.status not in ('prepared','generating','issued') or successor.supersedes_declaration_id<>old.id or successor.created_at<=old.created_at then
        raise exception 'invalid declaration supersession';
      end if;
      return new;
    end if;
    if new is not distinct from old then return new; end if;
    raise exception 'invalid issued declaration transition';
  end if;
  if old.status='draft' and new.status in ('draft','prepared') then return new; end if;
  if old.status='prepared' and new.status in ('generating','failed') then return new; end if;
  if old.status='generating' and new.status in ('prepared','issued','failed') then return new; end if;
  if old.status='failed' and new.status in ('draft','prepared') then return new; end if;
  raise exception 'invalid declaration transition';
end $$;

create trigger technical_file_declaration_immutable
before update on public.technical_file_declarations
for each row execute function public.m7_reject_technical_file_declaration_mutation();

alter table public.technical_file_declaration_templates enable row level security;
alter table public.technical_file_declarations enable row level security;
revoke all on table public.technical_file_declaration_templates,public.technical_file_declarations from public,anon,authenticated;
grant select on public.technical_file_declaration_templates to service_role;
grant all on public.technical_file_declarations to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('technical-file-declarations','technical-file-declarations',false,26214400,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=26214400,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.m7_declaration_json(p_organization_id uuid,p_declaration_id uuid,p_include_payload boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
   'id',d.id,'organizationId',d.organization_id,'productId',d.product_id,'snapshotId',d.snapshot_id,'templateId',d.template_id,
   'version',d.declaration_version,'draftVersion',d.draft_version,'status',case when d.status in ('issued','superseded') then d.status else 'draft' end,
   'signatory',jsonb_build_object('userId',d.signatory_user_id,'name',d.signatory_name,'capacity',d.signatory_capacity,'place',coalesce(d.signatory_place,d.issue_place)),
   'assessmentRoute',d.assessment_route,
   'notifiedBody',case when d.notified_body_identifier is null then null else jsonb_build_object('identifier',d.notified_body_identifier) end,
   'certificateReferences',d.certificate_references,'sourceProvenance',d.source_provenance,'missingFacts',d.missing_facts,
   'previewDigest',coalesce(d.preview_digest,repeat('0',64)),
   'snapshotSha256',coalesce(d.snapshot_sha256,(select payload_sha256 from public.technical_file_snapshots s where s.organization_id=d.organization_id and s.id=d.snapshot_id)),
   'issuedPayload',case when d.status in ('issued','superseded') then d.immutable_payload || jsonb_build_object('issuedAt',to_char(d.issued_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) else null end,
   'issuedArtifact',case when d.status in ('issued','superseded') then jsonb_build_object('fileName','eu-declaration-of-conformity-v'||d.declaration_version||'.pdf','mimeType','application/pdf','byteLength',d.pdf_bytes,'sha256',d.pdf_sha256) else null end,
   'issuedAt',case when d.issued_at is null then null else to_char(d.issued_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
   'supersededByDeclarationId',d.superseded_by_declaration_id,'supersedesDeclarationId',d.supersedes_declaration_id,'reissueReason',d.reissue_reason,
   'createdAt',to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 ) from public.technical_file_declarations d join public.technical_file_declaration_templates t on t.id=d.template_id where d.organization_id=p_organization_id and d.id=p_declaration_id
$$;

create or replace function public.get_technical_file_declaration_preview(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_signatory_capacity text,p_issue_place text,p_assessment_route text default null,p_notified_body_identifier text default null,p_certificate_references jsonb default '[]'::jsonb)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.technical_file_snapshots%rowtype; p public.products%rowtype; u public.users%rowtype; t public.technical_file_declaration_templates%rowtype; payload jsonb; missing jsonb := '[]'::jsonb; provenance jsonb := '[]'::jsonb; digest text; v_next_version integer; v_template jsonb; v_standards text; v_readiness text; v_signatory jsonb; v_notified_body jsonb;
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_issue_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select * into s from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share;
 select * into p from public.products where organization_id=p_organization_id and id=p_product_id and archived_at is null for share;
 select * into u from public.users where id=p_actor_user_id and is_active for share;
 select * into t from public.technical_file_declaration_templates where template_key='cra-annex-v-eu-declaration-of-conformity' and template_version='2024-11-20';
 if not found or s.id is null or p.id is null or u.id is null then return query select 'not_found',null::jsonb; return; end if;
 v_readiness:=coalesce(public.m7_evidence_readiness_json(p_organization_id,p_product_id)->>'overallStatus','empty');
 select string_agg(distinct concat_ws(' ',nullif(btrim(x.title),''),nullif(btrim(x.edition_or_revision),''),nullif(btrim(x.issuer),'')), '; ' order by concat_ws(' ',nullif(btrim(x.title),''),nullif(btrim(x.edition_or_revision),''),nullif(btrim(x.issuer),'')))
 into v_standards
 from public.technical_file_section_sources x
 join public.technical_file_sections sec on sec.organization_id=x.organization_id and sec.id=x.section_id
 join public.technical_files f on f.organization_id=sec.organization_id and f.id=sec.technical_file_id
 where x.organization_id=p_organization_id and f.product_id=p_product_id and f.status='active'
   and public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='current'
   and nullif(btrim(x.title),'') is not null;
 select coalesce(max(declaration_version),0)+1 into v_next_version from public.technical_file_declarations where organization_id=p_organization_id and product_id=p_product_id;
 v_template:=jsonb_build_object('id',t.id,'key','eu_declaration_of_conformity','version',t.template_version,'legalAct',t.regulation_reference,'annex','Annex V','language','en','mandatoryContentKeys',t.mandatory_field_keys,'isActive',true,'createdAt',to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 v_signatory:=jsonb_build_object('userId',u.id,'name',coalesce(nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),u.email),'capacity',btrim(coalesce(p_signatory_capacity,'')),'place',btrim(coalesce(p_issue_place,'')));
 v_notified_body:=case when nullif(btrim(coalesce(p_notified_body_identifier,'')),'') is null then null else jsonb_build_object('identifier',btrim(p_notified_body_identifier)) end;
 provenance:=provenance||jsonb_build_array(jsonb_build_object('key','productIdentity','label','Product identity, type, and traceability','sourceKind','product','sourceId',p.id,'observedRevision',p.updated_at::text,'value',concat_ws(' / ',nullif(btrim(p.name),''),nullif(btrim(p.product_type),''),nullif(btrim(p.internal_code),'')),'status',case when coalesce(nullif(btrim(p.name),''),'')<>'' and coalesce(nullif(btrim(p.internal_code),''),'')<>'' and coalesce(nullif(btrim(p.product_type),''),'')<>'' then 'current' else 'missing' end));
 provenance:=provenance||jsonb_build_array(jsonb_build_object('key','manufacturer','label','Manufacturer legal identity and address','sourceKind','legal_entity','sourceId',p.id,'observedRevision',p.updated_at::text,'value',concat_ws(' / ',nullif(btrim(p.legal_entity_snapshot->>'legalName'),''),nullif(btrim(p.legal_entity_snapshot->>'identifier'),''),nullif(btrim(coalesce(p.legal_entity_snapshot->>'registeredAddress',p.legal_entity_snapshot->>'address')),'')),'status',case when coalesce(nullif(btrim(p.legal_entity_snapshot->>'legalName'),''),'')<>'' and coalesce(nullif(btrim(p.legal_entity_snapshot->>'identifier'),''),'')<>'' then 'current' else 'missing' end));
 provenance:=provenance||jsonb_build_array(jsonb_build_object('key','technicalFileReadiness','label','Selected complete technical-file snapshot','sourceKind','snapshot','sourceId',s.id,'observedRevision',s.payload_sha256,'value','Snapshot '||s.id::text,'status',case when s.status='current' and s.readiness_status='complete' and s.technical_file_version=(select version from public.technical_files where organization_id=p_organization_id and id=s.technical_file_id and status='active') and v_readiness='complete' then 'current' else 'stale' end));
 provenance:=provenance||jsonb_build_array(jsonb_build_object('key','standardsOrSpecifications','label','Standards, common specifications, or certification references','sourceKind','technical_file_source','sourceId',null,'observedRevision',s.payload_sha256,'value',nullif(btrim(coalesce(v_standards,'')),''),'status',case when nullif(btrim(coalesce(v_standards,'')),'') is null then 'missing' else 'current' end));
 if (provenance->0->>'status')<>'current' then missing:=missing||jsonb_build_array(jsonb_build_object('key','productIdentity','label','Product identity, type, and traceability','reason','The product name, product type, and traceability/internal code must be recorded.')); end if;
 if (provenance->1->>'status')<>'current' then missing:=missing||jsonb_build_array(jsonb_build_object('key','manufacturer','label','Manufacturer legal identity and address','reason','The approved manufacturer legal profile must include legal name and identifier.')); end if;
 if (provenance->2->>'status')<>'current' then missing:=missing||jsonb_build_array(jsonb_build_object('key','technicalFileReadiness','label','Complete current technical-file snapshot','reason','The selected snapshot must be current, complete, and match current technical-file readiness.')); end if;
 if (provenance->3->>'status')<>'current' then missing:=missing||jsonb_build_array(jsonb_build_object('key','standardsOrSpecifications','label','Standards, common specifications, or certification references','reason','At least one current source reference must be present in the selected technical file.')); end if;
 if char_length(btrim(coalesce(p_signatory_capacity,''))) not between 1 and 300 or char_length(btrim(coalesce(p_issue_place,''))) not between 1 and 300 then missing:=missing||jsonb_build_array(jsonb_build_object('key','signatory','label','Responsible signatory and place of issue','reason','Record the named signatory capacity and the place of issue.')); end if;
 if p_assessment_route not in ('internal_control','eu_type_examination','full_quality_assurance') and p_assessment_route is not null then missing:=missing||jsonb_build_array(jsonb_build_object('key','assessmentRoute','label','Conformity assessment route','reason','Select a supported route or leave route blank for V1.')); end if;
 if p_assessment_route in ('eu_type_examination','full_quality_assurance') and (coalesce(p_notified_body_identifier,'') !~ '^[0-9]{4}$' or jsonb_typeof(coalesce(p_certificate_references,'null'::jsonb))<>'array' or jsonb_array_length(p_certificate_references)=0) then missing:=missing||jsonb_build_array(jsonb_build_object('key','notifiedBodyCertificate','label','Notified body and certificate reference','reason','Notified-body routes require a four-digit notified-body identifier and at least one certificate reference.')); end if;
 if (p_assessment_route is null or p_assessment_route='internal_control') and (p_notified_body_identifier is not null or coalesce(jsonb_array_length(p_certificate_references),0)<>0) then missing:=missing||jsonb_build_array(jsonb_build_object('key','assessmentRoute','label','Conformity assessment route','reason','V1 and internal-control declarations cannot include notified-body data.')); end if;
 payload:=jsonb_build_object('schemaVersion','m7_05_v1','declarationVersion',v_next_version,'template',v_template,'snapshotId',s.id,'snapshotSha256',s.payload_sha256,'signatory',v_signatory,'assessmentRoute',p_assessment_route,'notifiedBody',v_notified_body,'certificateReferences',coalesce(p_certificate_references,'[]'::jsonb),'sourceProvenance',provenance,'signatureNotice','This declaration identifies a responsible signatory and is not a cryptographic or qualified electronic signature.');
 digest:=encode(extensions.digest(payload::text,'sha256'),'hex');
 return query select case when jsonb_array_length(missing)=0 then 'ready' else 'blocked' end,
   jsonb_build_object('template',v_template,'snapshotId',s.id,'snapshotSha256',s.payload_sha256,'expectedVersion',v_next_version,'signatory',v_signatory,'assessmentRoute',p_assessment_route,'notifiedBody',v_notified_body,'certificateReferences',coalesce(p_certificate_references,'[]'::jsonb),'sourceProvenance',provenance,'missingFacts',missing,'readinessStatus',case when jsonb_array_length(missing)=0 then 'complete' else s.readiness_status end,'canIssue',jsonb_array_length(missing)=0,'previewDigest',digest,'payload',payload);
end $$;

create or replace function public.upsert_technical_file_declaration_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_declaration_id uuid,p_expected_draft_version integer,p_signatory_capacity text,p_issue_place text,p_assessment_route text,p_notified_body_identifier text,p_certificate_references jsonb,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.technical_file_declarations%rowtype; t public.technical_file_declaration_templates%rowtype; v_command_digest text; next_version integer; preview record;
begin
 if p_idempotency_key is null or p_expected_draft_version<1 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_issue_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 v_command_digest:=encode(extensions.digest(jsonb_build_object('operation','draft','productId',p_product_id,'snapshotId',p_snapshot_id,'declarationId',p_declaration_id,'expectedDraftVersion',p_expected_draft_version,'signatoryCapacity',btrim(p_signatory_capacity),'issuePlace',btrim(p_issue_place),'assessmentRoute',p_assessment_route,'notifiedBodyIdentifier',p_notified_body_identifier,'certificateReferences',p_certificate_references)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
 select * into d from public.technical_file_declarations where organization_id=p_organization_id and signatory_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
   if d.command_digest=v_command_digest then return query select 'replayed',public.m7_declaration_json(p_organization_id,d.id); else return query select 'idempotency_conflict',null::jsonb; end if;
   return;
 end if;
 select * into t from public.technical_file_declaration_templates where template_key='cra-annex-v-eu-declaration-of-conformity' and template_version='2024-11-20';
 if p_declaration_id is null then
   if not exists(select 1 from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id) then return query select 'not_found',null::jsonb; return; end if;
   select coalesce(max(declaration_version),0)+1 into next_version from public.technical_file_declarations where organization_id=p_organization_id and product_id=p_product_id;
   insert into public.technical_file_declarations(organization_id,product_id,snapshot_id,template_id,declaration_version,signatory_user_id,signatory_name,signatory_capacity,issue_place,assessment_route,notified_body_identifier,certificate_references,idempotency_key,command_digest) values(p_organization_id,p_product_id,p_snapshot_id,t.id,next_version,p_actor_user_id,(select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),email) from public.users where id=p_actor_user_id),btrim(p_signatory_capacity),btrim(p_issue_place),p_assessment_route,nullif(btrim(coalesce(p_notified_body_identifier,'')),''),coalesce(p_certificate_references,'[]'::jsonb),p_idempotency_key,v_command_digest) returning * into d;
 else
   select * into d from public.technical_file_declarations where organization_id=p_organization_id and product_id=p_product_id and id=p_declaration_id for update;
   if not found then return query select 'not_found',null::jsonb; return; end if;
   if d.status<>'draft' or d.draft_version<>p_expected_draft_version then return query select 'conflict',public.m7_declaration_json(p_organization_id,d.id); return; end if;
   if not exists(select 1 from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id) then return query select 'not_found',null::jsonb; return; end if;
   update public.technical_file_declarations set snapshot_id=p_snapshot_id,signatory_capacity=btrim(p_signatory_capacity),issue_place=btrim(p_issue_place),assessment_route=p_assessment_route,notified_body_identifier=nullif(btrim(coalesce(p_notified_body_identifier,'')),''),certificate_references=coalesce(p_certificate_references,'[]'::jsonb),draft_version=draft_version+1,updated_at=clock_timestamp(),idempotency_key=p_idempotency_key,command_digest=v_command_digest where organization_id=p_organization_id and id=d.id returning * into d;
 end if;
 select * into preview from public.get_technical_file_declaration_preview(p_organization_id,p_actor_user_id,p_product_id,d.snapshot_id,d.signatory_capacity,d.issue_place,d.assessment_route,d.notified_body_identifier,d.certificate_references);
 if preview.outcome not in ('ready','blocked') then return query select 'invalid_request',preview.result; return; end if;
 update public.technical_file_declarations set preview_digest=preview.result->>'previewDigest',snapshot_sha256=preview.result->>'snapshotSha256',source_provenance=preview.result->'sourceProvenance',missing_facts=preview.result->'missingFacts',updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id returning * into d;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.declaration_draft_saved','technical_file_declaration',d.id::text,jsonb_build_object('declarationId',d.id,'idempotencyKey',p_idempotency_key,'commandDigest',v_command_digest,'previewDigest',d.preview_digest));
 return query select 'saved',public.m7_declaration_json(p_organization_id,d.id);
end $$;

create or replace function public.issue_technical_file_declaration_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_declaration_id uuid,p_expected_draft_version integer,p_preview_digest text,p_snapshot_sha256 text,p_confirmed boolean,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.technical_file_declarations%rowtype; preview record; v_command_digest text;
begin
 if not p_confirmed or p_idempotency_key is null or p_expected_draft_version<1 or p_preview_digest !~ '^[a-f0-9]{64}$' or p_snapshot_sha256 !~ '^[a-f0-9]{64}$' or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_issue_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 v_command_digest:=encode(extensions.digest(jsonb_build_object('operation','issue','declarationId',p_declaration_id,'expectedDraftVersion',p_expected_draft_version,'previewDigest',p_preview_digest,'snapshotSha256',p_snapshot_sha256)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
 select * into d from public.technical_file_declarations where organization_id=p_organization_id and product_id=p_product_id and id=p_declaration_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if d.idempotency_key=p_idempotency_key and d.command_digest=v_command_digest and d.status in ('prepared','generating','issued') then return query select 'replayed',public.m7_declaration_json(p_organization_id,d.id,true); return; end if;
 if d.status<>'draft' or d.draft_version<>p_expected_draft_version then return query select 'conflict',public.m7_declaration_json(p_organization_id,d.id); return; end if;
 if d.supersedes_declaration_id is null and exists(select 1 from public.technical_file_declarations current_issued where current_issued.organization_id=p_organization_id and current_issued.product_id=p_product_id and current_issued.status='issued' and current_issued.id<>d.id) then
   return query select 'conflict',public.m7_declaration_json(p_organization_id,(select current_issued.id from public.technical_file_declarations current_issued where current_issued.organization_id=p_organization_id and current_issued.product_id=p_product_id and current_issued.status='issued' order by current_issued.declaration_version desc limit 1));
   return;
 end if;
 select * into preview from public.get_technical_file_declaration_preview(p_organization_id,p_actor_user_id,p_product_id,d.snapshot_id,d.signatory_capacity,d.issue_place,d.assessment_route,d.notified_body_identifier,d.certificate_references);
 if preview.outcome<>'ready' then return query select 'blocked',preview.result; return; end if;
 if preview.result->>'previewDigest'<>p_preview_digest or preview.result->>'snapshotSha256'<>p_snapshot_sha256 then return query select 'conflict',preview.result; return; end if;
 update public.technical_file_declarations set status='prepared',preview_digest=p_preview_digest,snapshot_sha256=p_snapshot_sha256,source_provenance=preview.result->'sourceProvenance',missing_facts=preview.result->'missingFacts',immutable_payload=preview.result->'payload',immutable_payload_sha256=p_preview_digest,idempotency_key=p_idempotency_key,command_digest=v_command_digest,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.declaration_issuance_prepared','technical_file_declaration',d.id::text,jsonb_build_object('declarationId',d.id,'idempotencyKey',p_idempotency_key,'commandDigest',v_command_digest,'previewDigest',p_preview_digest,'snapshotSha256',p_snapshot_sha256));
 return query select 'prepared',public.m7_declaration_json(p_organization_id,d.id,true);
end $$;

create or replace function public.claim_technical_file_declaration(p_worker_id uuid,p_lease_seconds integer default 120)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.technical_file_declarations%rowtype;
begin
 if p_worker_id is null or p_lease_seconds not between 30 and 900 then return query select 'invalid_request',null::jsonb; return; end if;
 select * into d from public.technical_file_declarations where status='prepared' or (status='generating' and lease_expires_at<=clock_timestamp()) order by created_at,id limit 1 for update skip locked;
 if not found then return query select 'empty',null::jsonb; return; end if;
 update public.technical_file_declarations set status='generating',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp() where id=d.id;
 return query select 'claimed',jsonb_build_object('declaration',public.m7_declaration_json(d.organization_id,d.id), 'payload',d.immutable_payload);
end $$;

create or replace function public.finalize_technical_file_declaration_atomic(p_organization_id uuid,p_declaration_id uuid,p_worker_id uuid,p_pdf_object_path text,p_pdf_sha256 text,p_pdf_bytes bigint)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.technical_file_declarations%rowtype; predecessor public.technical_file_declarations%rowtype;
begin
 select * into d from public.technical_file_declarations where organization_id=p_organization_id and id=p_declaration_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if d.status='issued' and d.pdf_object_path=p_pdf_object_path and d.pdf_sha256=p_pdf_sha256 and d.pdf_bytes=p_pdf_bytes then return query select 'replayed',public.m7_declaration_json(p_organization_id,d.id); return; end if;
 if d.status<>'generating' or d.lease_owner<>p_worker_id or d.lease_expires_at<=clock_timestamp() then return query select 'conflict',public.m7_declaration_json(p_organization_id,d.id); return; end if;
 if p_pdf_object_path ~ '(^|/)\\.\\.(/|$)' or p_pdf_object_path ~ '^/' or p_pdf_sha256 !~ '^[a-f0-9]{64}$' or p_pdf_bytes not between 1 and 26214400 then return query select 'invalid_request',null::jsonb; return; end if;
 if d.supersedes_declaration_id is not null then
   select * into predecessor from public.technical_file_declarations where organization_id=p_organization_id and id=d.supersedes_declaration_id for update;
   if not found or predecessor.status<>'issued' or predecessor.product_id<>d.product_id then return query select 'conflict',public.m7_declaration_json(p_organization_id,d.id); return; end if;
   update public.technical_file_declarations set status='superseded',superseded_by_declaration_id=d.id,updated_at=clock_timestamp() where organization_id=p_organization_id and id=predecessor.id;
 end if;
 update public.technical_file_declarations set status='issued',lease_owner=null,lease_expires_at=null,pdf_object_path=p_pdf_object_path,pdf_sha256=p_pdf_sha256,pdf_bytes=p_pdf_bytes,issued_at=clock_timestamp(),updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'technical_file.declaration_issued','technical_file_declaration',d.id::text,jsonb_build_object('declarationId',d.id,'pdfSha256',p_pdf_sha256));
 return query select 'issued',public.m7_declaration_json(p_organization_id,d.id);
end $$;

create or replace function public.fail_technical_file_declaration_atomic(p_organization_id uuid,p_declaration_id uuid,p_worker_id uuid,p_failure_code text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.technical_file_declarations%rowtype;
begin
 select * into d from public.technical_file_declarations where organization_id=p_organization_id and id=p_declaration_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if p_failure_code not in ('storage_unavailable','renderer_unavailable','source_unavailable','unknown') then return query select 'invalid_request',null::jsonb; return; end if;
 if d.status<>'generating' or d.lease_owner<>p_worker_id then return query select 'conflict',public.m7_declaration_json(p_organization_id,d.id); return; end if;
 update public.technical_file_declarations set status='failed',failure_code=p_failure_code,lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'technical_file.declaration_failed','technical_file_declaration',d.id::text,jsonb_build_object('declarationId',d.id,'failureCode',p_failure_code));
 return query select 'failed',public.m7_declaration_json(p_organization_id,d.id);
end $$;

create or replace function public.get_technical_file_declarations(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('declarations',coalesce((select jsonb_agg(public.m7_declaration_json(p_organization_id,d.id) order by d.declaration_version desc,d.created_at desc) from public.technical_file_declarations d where d.organization_id=p_organization_id and d.product_id=p_product_id),'[]'::jsonb));
end $$;

create or replace function public.get_technical_file_declaration_download_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_declaration_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.technical_file_declarations%rowtype;
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select * into d from public.technical_file_declarations where organization_id=p_organization_id and product_id=p_product_id and id=p_declaration_id and status in ('issued','superseded');
 if not found then return query select 'not_found',null::jsonb; return; end if;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.declaration_downloaded','technical_file_declaration',d.id::text,jsonb_build_object('declarationId',d.id));
 return query select 'found',jsonb_build_object('objectPath',d.pdf_object_path,'artifact',jsonb_build_object('fileName','eu-declaration-of-conformity-v'||d.declaration_version||'.pdf','mimeType','application/pdf','byteLength',d.pdf_bytes,'sha256',d.pdf_sha256));
end $$;

create or replace function public.reissue_technical_file_declaration_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_current_declaration_id uuid,p_expected_declaration_version integer,p_snapshot_id uuid,p_reason text,p_signatory_capacity text,p_issue_place text,p_assessment_route text,p_notified_body_identifier text,p_certificate_references jsonb,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare current_declaration public.technical_file_declarations%rowtype; new_declaration public.technical_file_declarations%rowtype; next_version integer; t public.technical_file_declaration_templates%rowtype; command_digest text;
begin
 if p_idempotency_key is null or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_issue_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 command_digest:=encode(extensions.digest(jsonb_build_object('operation','reissue','currentDeclarationId',p_current_declaration_id,'expectedDeclarationVersion',p_expected_declaration_version,'snapshotId',p_snapshot_id,'reason',btrim(p_reason))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_current_declaration_id::text,0));
 select * into new_declaration from public.technical_file_declarations where organization_id=p_organization_id and signatory_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
   if new_declaration.command_digest=command_digest then return query select 'replayed',public.m7_declaration_json(p_organization_id,new_declaration.id); else return query select 'idempotency_conflict',null::jsonb; end if;
   return;
 end if;
 select * into current_declaration from public.technical_file_declarations where organization_id=p_organization_id and product_id=p_product_id and id=p_current_declaration_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if current_declaration.status<>'issued' or current_declaration.declaration_version<>p_expected_declaration_version then return query select 'conflict',public.m7_declaration_json(p_organization_id,current_declaration.id); return; end if;
 if not exists(select 1 from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id) then return query select 'not_found',null::jsonb; return; end if;
 select * into t from public.technical_file_declaration_templates where template_key='cra-annex-v-eu-declaration-of-conformity' and template_version='2024-11-20';
 select coalesce(max(declaration_version),0)+1 into next_version from public.technical_file_declarations where organization_id=p_organization_id and product_id=p_product_id;
 insert into public.technical_file_declarations(organization_id,product_id,snapshot_id,template_id,declaration_version,signatory_user_id,signatory_name,signatory_capacity,issue_place,assessment_route,notified_body_identifier,certificate_references,reissue_reason,supersedes_declaration_id,idempotency_key,command_digest) values(p_organization_id,p_product_id,p_snapshot_id,t.id,next_version,p_actor_user_id,(select coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),email) from public.users where id=p_actor_user_id),btrim(p_signatory_capacity),btrim(p_issue_place),p_assessment_route,nullif(btrim(coalesce(p_notified_body_identifier,'')),''),coalesce(p_certificate_references,'[]'::jsonb),btrim(p_reason),current_declaration.id,p_idempotency_key,command_digest) returning * into new_declaration;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.declaration_reissued','technical_file_declaration',new_declaration.id::text,jsonb_build_object('declarationId',new_declaration.id,'supersedesDeclarationId',current_declaration.id,'reason',btrim(p_reason),'idempotencyKey',p_idempotency_key,'commandDigest',command_digest));
 return query select 'created',public.m7_declaration_json(p_organization_id,new_declaration.id);
end $$;

revoke all on function public.m7_reject_technical_file_declaration_mutation(),public.m7_declaration_json(uuid,uuid,boolean),public.get_technical_file_declaration_preview(uuid,uuid,uuid,uuid,text,text,text,text,jsonb),public.upsert_technical_file_declaration_draft_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid),public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid),public.claim_technical_file_declaration(uuid,integer),public.finalize_technical_file_declaration_atomic(uuid,uuid,uuid,text,text,bigint),public.fail_technical_file_declaration_atomic(uuid,uuid,uuid,text),public.get_technical_file_declarations(uuid,uuid,uuid),public.get_technical_file_declaration_download_atomic(uuid,uuid,uuid,uuid),public.reissue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,uuid,text,text,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.m7_declaration_json(uuid,uuid,boolean),public.get_technical_file_declaration_preview(uuid,uuid,uuid,uuid,text,text,text,text,jsonb),public.upsert_technical_file_declaration_draft_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid),public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid),public.claim_technical_file_declaration(uuid,integer),public.finalize_technical_file_declaration_atomic(uuid,uuid,uuid,text,text,bigint),public.fail_technical_file_declaration_atomic(uuid,uuid,uuid,text),public.get_technical_file_declarations(uuid,uuid,uuid),public.get_technical_file_declaration_download_atomic(uuid,uuid,uuid,uuid),public.reissue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,uuid,text,text,text,text,text,jsonb,uuid) to service_role;
alter function public.m7_reject_technical_file_declaration_mutation() owner to postgres;
alter function public.m7_declaration_json(uuid,uuid,boolean) owner to postgres;
alter function public.get_technical_file_declaration_preview(uuid,uuid,uuid,uuid,text,text,text,text,jsonb) owner to postgres;
alter function public.upsert_technical_file_declaration_draft_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid) owner to postgres;
alter function public.issue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,text,text,boolean,uuid) owner to postgres;
alter function public.claim_technical_file_declaration(uuid,integer) owner to postgres;
alter function public.finalize_technical_file_declaration_atomic(uuid,uuid,uuid,text,text,bigint) owner to postgres;
alter function public.fail_technical_file_declaration_atomic(uuid,uuid,uuid,text) owner to postgres;
alter function public.get_technical_file_declarations(uuid,uuid,uuid) owner to postgres;
alter function public.get_technical_file_declaration_download_atomic(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.reissue_technical_file_declaration_atomic(uuid,uuid,uuid,uuid,integer,uuid,text,text,text,text,text,jsonb,uuid) owner to postgres;
notify pgrst, 'reload schema';
