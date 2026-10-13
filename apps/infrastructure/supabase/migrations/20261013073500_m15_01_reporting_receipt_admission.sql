-- Customer receipts share the bounded uploader. Only source-verified completion
-- of a pre-cutoff real M6 duty is separately accounted protected input.
alter table public.organization_storage_admissions add column protected_input boolean not null default false;
alter table public.organization_storage_admissions drop constraint organization_storage_admissions_check1;
alter table public.organization_storage_admissions add constraint organization_storage_admissions_source_check check (
 (actor_user_id is not null and source_context is null)
 or (actor_user_id is null and source_context is not null)
 or (actor_user_id is not null and bucket='reporting-evidence' and source_context->>'kind'='reporting_receipt'
     and source_context->>'organizationId'=organization_id::text and source_context->>'actorId'=actor_user_id::text)
);

create function public.m15_01_reporting_receipt_protected(p_organization_id uuid,p_obligation_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select o.status='active' and not o.is_rehearsal
  and o.created_at<=coalesce(s.protected_regulatory_cutoff,(s.verified_claims->>'expiresAt')::timestamptz+interval '30 days',clock_timestamp())
 from public.reporting_obligations o left join public.organization_license_states s on s.organization_id=o.organization_id
 where o.organization_id=p_organization_id and o.id=p_obligation_id),false)
$$;

create function public.m15_01_reporting_receipt_allowed(p_organization_id uuid,p_actor_user_id uuid,p_object_path text,p_bytes bigint,p_context jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o public.reporting_obligations%rowtype;p public.reporting_stage_packages%rowtype;a public.reporting_stage_approvals%rowtype;
 d public.reporting_stage_drafts%rowtype;f public.reporting_stage_filing_proofs%rowtype;st public.reporting_obligation_stages%rowtype;expected_path text;
begin
 if p_context->>'kind' is distinct from 'reporting_receipt' or p_context->>'organizationId' is distinct from p_organization_id::text
 or p_context->>'actorId' is distinct from p_actor_user_id::text or p_bytes not between 1 and 10485760
 or not public.m14_04_member(p_organization_id,p_actor_user_id)
 or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return false;end if;
 select * into o from public.reporting_obligations where organization_id=p_organization_id and id=(p_context->>'obligationId')::uuid;
 select * into p from public.reporting_stage_packages where organization_id=p_organization_id and id=(p_context->>'packageId')::uuid;
 select * into a from public.reporting_stage_approvals where organization_id=p_organization_id and id=(p_context->>'approvalId')::uuid;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=a.draft_id;
 select * into f from public.reporting_stage_filing_proofs where organization_id=p_organization_id and id=(p_context->>'proofId')::uuid;
 select * into st from public.reporting_obligation_stages where organization_id=p_organization_id and id=(p_context->>'stageId')::uuid;
 expected_path:=(case when o.is_rehearsal then 'rehearsals/' else '' end)||p_organization_id::text||'/'||st.id::text||'/filings/'||(p_context->>'idempotencyKey')::uuid::text||'/receipt.';
 return coalesce(o.id is not null and p.id is not null and a.id is not null and d.id is not null and f.id is not null and st.id is not null
  and o.status='active' and o.is_rehearsal=(p_context->>'isRehearsal')::boolean
  and st.obligation_id=o.id and p.obligation_id=o.id and p.stage_id=st.id and a.obligation_id=o.id and a.stage_id=st.id
  and p.approval_id=a.id and p.draft_id=d.id and p.draft_revision=a.draft_revision and p.draft_hash=a.draft_hash
  and d.obligation_id=o.id and d.stage_id=st.id and d.version=a.draft_revision and public.m6_reporting_draft_hash(d)=a.draft_hash
  and exists(select 1 from public.product_releases r join public.products pr on pr.organization_id=r.organization_id and pr.id=r.product_id where r.organization_id=p_organization_id and r.id=d.release_id)
  and p.state='available' and f.package_id=p.id and f.approval_id=a.id and f.actor_user_id=p_actor_user_id
  and f.session_id=(p_context->>'sessionId')::uuid and f.consumed_at is null and f.expires_at>clock_timestamp()
  and f.action_digest=encode(extensions.digest('{"idempotencyKey":"'||(p_context->>'idempotencyKey')::uuid::text||'","packageId":"'||p.id::text||'"}','sha256'),'hex')
  and p_object_path in (expected_path||'pdf',expected_path||'png',expected_path||'jpg',expected_path||'txt')
  and not exists(select 1 from public.reporting_stage_submissions rs where rs.organization_id=p_organization_id and rs.stage_id=st.id),false);
exception when invalid_text_representation then return false;
end $$;

-- A filing retry must retain a completed receipt, never mint new upload
-- authority for that path. Source authorization and exact content are rechecked.
create function public.m15_01_replay_reporting_receipt(p_organization_id uuid,p_actor_user_id uuid,p_object_path text,p_bytes bigint,p_content_type text,p_sha256 text,p_context jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;
begin
 if not public.m15_01_reporting_receipt_allowed(p_organization_id,p_actor_user_id,p_object_path,p_bytes,p_context)
  then return jsonb_build_object('outcome','forbidden');end if;
 select * into a from public.organization_storage_admissions where organization_id=p_organization_id and bucket='reporting-evidence' and object_path=p_object_path;
 if not found or a.state='reserved' then return jsonb_build_object('outcome','absent');end if;
 if a.state='completed' and a.actor_user_id=p_actor_user_id and a.source_context=p_context
  and a.reserved_bytes=p_bytes and a.observed_bytes=p_bytes and a.content_type=p_content_type
  and a.content_sha256=p_sha256 and public.m15_01_storage_object_matches(a)
  then return jsonb_build_object('outcome','completed');end if;
 return jsonb_build_object('outcome','conflict');
end $$;
revoke all on function public.m15_01_replay_reporting_receipt(uuid,uuid,text,bigint,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.m15_01_replay_reporting_receipt(uuid,uuid,text,bigint,text,text,jsonb) to service_role;

create function public.m15_01_admitted_upload_allowed(p_admission public.organization_storage_admissions)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select case when p_admission.bucket='reporting-evidence' then
  public.m15_01_reporting_receipt_allowed(p_admission.organization_id,p_admission.actor_user_id,p_admission.object_path,p_admission.reserved_bytes,p_admission.source_context)
 else case when p_admission.actor_user_id is not null then
  public.m15_01_member_upload_allowed(p_admission.organization_id,p_admission.actor_user_id,p_admission.bucket,p_admission.object_path,p_admission.reserved_bytes)
 else public.m15_01_resolve_upload_owner(p_admission.bucket,p_admission.object_path,p_admission.reserved_bytes,p_admission.source_context) is not distinct from p_admission.organization_id end end
$$;

-- Modify only existing transport admission; M6 approval and filing functions keep
-- their signatures and remain the final human authorization source.
do $patch$
declare d text;sig regprocedure;before text;
begin
 sig:='public.m15_01_reserve_storage(uuid,uuid,uuid,text,text,bigint,text,timestamptz,text,jsonb,text)'::regprocedure;
 d:=pg_get_functiondef(sig);
 d:=replace(d,'if p_actor_user_id is null then o:=',
 'if p_bucket=''reporting-evidence'' then
  if not public.m15_01_reporting_receipt_allowed(o,p_actor_user_id,p_object_path,p_bytes,p_source_context) then return jsonb_build_object(''outcome'',''forbidden'');end if;
 elsif p_actor_user_id is null then o:=');
 d:=replace(d,'when ''evidence-documents'' then ''evidence''','when ''reporting-evidence'' then ''reporting'' when ''evidence-documents'' then ''evidence''');
 d:=replace(d,'when ''evidence-documents'' then 52428800','when ''reporting-evidence'' then 10485760 when ''evidence-documents'' then 52428800');
 d:=replace(d,'perform public.m15_01_assert_customer_write(o,p_capability);',
 'if not (p_bucket=''reporting-evidence'' and public.m15_01_reporting_receipt_protected(o,(p_source_context->>''obligationId'')::uuid)) then perform public.m15_01_assert_customer_write(o,p_capability);end if;');
 d:=replace(d,'if not s.storage_accounting_ready then',
 'if not coalesce(s.storage_accounting_ready,false) and not (p_bucket=''reporting-evidence'' and public.m15_01_reporting_receipt_protected(o,(p_source_context->>''obligationId'')::uuid)) then');
 d:=replace(d,'if cap is not null and (usage>cap or p_bytes>cap-usage) then',
 'if cap is not null and (usage>cap or p_bytes>cap-usage) and not (p_bucket=''reporting-evidence'' and public.m15_01_reporting_receipt_protected(o,(p_source_context->>''obligationId'')::uuid)) then');
 d:=replace(d,'capability,content_type)', 'capability,content_type,protected_input)');
 d:=replace(d,'p_capability,p_content_type) returning',
 'p_capability,p_content_type,(p_bucket=''reporting-evidence'' and public.m15_01_reporting_receipt_protected(o,(p_source_context->>''obligationId'')::uuid))) returning');
 execute d;
 for sig in select unnest(array['public.m15_01_claim_storage_upload(uuid,text)'::regprocedure,'public.m15_01_validate_storage_upload(uuid,text)'::regprocedure,'public.m15_01_complete_storage(uuid,uuid,uuid,text,bigint)'::regprocedure,'public.m15_01_reset_storage_upload(uuid,text)'::regprocedure]) loop
  d:=pg_get_functiondef(sig);before:=d;
  d:=replace(d,'not public.m15_01_member_upload_allowed(a.organization_id,a.actor_user_id,a.bucket,a.object_path,a.reserved_bytes)','not public.m15_01_admitted_upload_allowed(a)');
  d:=replace(d,'not public.m15_01_member_upload_allowed(p_organization_id,p_actor_user_id,a.bucket,a.object_path,a.reserved_bytes)','not public.m15_01_admitted_upload_allowed(a)');
  if d=before then raise exception 'reporting receipt source predicate drift: %',sig;end if;
  execute d;
 end loop;
end $patch$;

-- Source references disambiguate generated ZIPs from uploaded receipt inputs.
do $$ declare d text;begin
 d:=pg_get_functiondef('public.m15_01_customer_objects()'::regprocedure);
 d:=replace(d,'union select organization_id,''sbom-originals''',
 'union select organization_id,proof_storage_bucket,proof_object_path from public.reporting_stage_submissions where proof_object_path is not null
 union select organization_id,''sbom-originals''');execute d;
end $$;
insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,source_context,bucket,object_path,reserved_bytes,observed_bytes,token_digest,content_type,capability,state,expires_at,protected_input)
select rs.organization_id,so.id,null,jsonb_build_object('kind','existing'),so.bucket_id,so.name,(so.metadata->>'size')::bigint,(so.metadata->>'size')::bigint,repeat('0',64),rs.proof_mime_type,'reporting','completed',clock_timestamp(),public.m15_01_reporting_receipt_protected(rs.organization_id,rs.obligation_id)
from public.reporting_stage_submissions rs join storage.objects so on so.bucket_id=rs.proof_storage_bucket and so.name=rs.proof_object_path
where so.metadata->>'size' ~ '^[0-9]+$' and (so.metadata->>'size')::numeric<=9007199254740991
on conflict do nothing;

create or replace function public.m15_01_usage(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object(
 'activeMembers',(select count(*) from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id),
 'reservedInvitations',(select count(distinct lower(i.email)) from public.invitations i where i.organization_id=p_organization_id and i.status='pending' and i.expires_at>clock_timestamp()
 and not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=i.organization_id and lower(u.email)=lower(i.email))),
 'products',(select count(*) from public.products where organization_id=p_organization_id and archived_at is null),
 'storageBytes',(select coalesce(sum(observed_bytes),0) from public.organization_storage_admissions where organization_id=p_organization_id and state='completed' and not protected_input),
 'storageReservedBytes',(select coalesce(sum(reserved_bytes),0) from public.organization_storage_admissions where organization_id=p_organization_id and state in ('reserved','uploading','uncertain') and not protected_input),
 'protectedStorageBytes',
 (select coalesce(sum(case when state='completed' then observed_bytes else reserved_bytes end),0) from public.organization_storage_admissions where organization_id=p_organization_id and protected_input and state in ('reserved','uploading','uncertain','completed'))+
 (select coalesce(sum(case when so.metadata->>'size' ~ '^[0-9]+$' then (so.metadata->>'size')::bigint else 0 end),0) from storage.objects so
  where (so.name like p_organization_id::text||'/%' or so.name like 'rehearsals/'||p_organization_id::text||'/%')
  and so.bucket_id in ('audit-exports','filtered-exports','technical-file-snapshot-exports','technical-file-declarations','tenant-exports','evidence-watermark-exports','reporting-evidence')
  and not exists(select 1 from public.organization_storage_admissions a where a.organization_id=p_organization_id and a.bucket=so.bucket_id and a.object_path=so.name)
  and (so.bucket_id<>'reporting-evidence' or exists(select 1 from public.reporting_stage_packages p where p.organization_id=p_organization_id and p.storage_object_path=so.name)
   or exists(select 1 from public.reporting_obligation_evidence_packs ep where ep.organization_id=p_organization_id and ep.storage_object_path=so.name)))
 )
$$;

create or replace function public.m15_01_storage_accounting_ready(p_organization_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select not exists(select 1 from storage.objects so
  where so.bucket_id in ('evidence-documents','sbom-originals','organization-branding','product-imports','security-update-artifacts','reporting-evidence')
  and (so.name like p_organization_id::text||'/%' or so.name like 'rehearsals/'||p_organization_id::text||'/%'
   or exists(select 1 from public.m15_01_customer_objects() c where c.organization_id=p_organization_id and c.bucket=so.bucket_id and c.object_path=so.name))
  and not (so.bucket_id='reporting-evidence' and (exists(select 1 from public.reporting_stage_packages p where p.organization_id=p_organization_id and p.storage_object_path=so.name)
   or exists(select 1 from public.reporting_obligation_evidence_packs ep where ep.organization_id=p_organization_id and ep.storage_object_path=so.name)))
  and (so.metadata->>'size' is null or so.metadata->>'size' !~ '^[0-9]+$'
   or not exists(select 1 from public.organization_storage_admissions a where a.organization_id=p_organization_id and a.bucket=so.bucket_id and a.object_path=so.name)))
$$;
-- Refresh tenant readiness after the source-bound receipt backfill.
update public.organization_license_states s set storage_accounting_ready=public.m15_01_storage_accounting_ready(s.organization_id);
revoke all on function public.m15_01_reporting_receipt_protected(uuid,uuid),public.m15_01_reporting_receipt_allowed(uuid,uuid,text,bigint,jsonb),public.m15_01_admitted_upload_allowed(public.organization_storage_admissions) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
