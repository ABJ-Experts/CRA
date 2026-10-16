-- Local licensing authorities. Signed verification remains API-owned; only the
-- service role can submit verified claims, and mutation authorities recheck here.
create table public.organization_license_states (
 organization_id uuid primary key references public.organizations(id),
 artifact text not null check(octet_length(artifact)<=32768),
 artifact_digest text not null check(artifact_digest ~ '^[a-f0-9]{64}$'),
 artifact_object_path text not null,
 verified_claims jsonb not null check(jsonb_typeof(verified_claims)='object'),
 issuance_sequence bigint not null check(issuance_sequence between 1 and 9007199254740991),
 version integer not null check(version>0),
 time_high_water_at timestamptz not null,
 clock_rollback_detected boolean not null default false,
 protected_regulatory_cutoff timestamptz,
 storage_accounting_ready boolean not null default false,
 updated_at timestamptz not null default clock_timestamp(),
 check(artifact_object_path=organization_id::text||'/'||artifact_digest||'.jws'),
 check(verified_claims->>'organizationId'=organization_id::text)
);
create table public.organization_storage_admissions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 operation_id uuid not null unique, actor_user_id uuid references public.users(id),source_context jsonb,
 bucket text not null check(length(bucket) between 1 and 100),
 object_path text not null check(length(object_path) between 1 and 1024 and object_path !~ '(^|/)\.\.(/|$)'),
 reserved_bytes bigint not null check(reserved_bytes between 0 and 9007199254740991),
 observed_bytes bigint check(observed_bytes between 0 and reserved_bytes),
 token_digest text not null check(token_digest ~ '^[a-f0-9]{64}$'),
 content_type text not null check(length(content_type) between 1 and 200),
 capability text not null,
 state text not null default 'reserved' check(state in ('reserved','uploading','completed','uncertain','released')),
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,operation_id),unique(organization_id,bucket,object_path),
 check((actor_user_id is not null and source_context is null) or (actor_user_id is null and source_context is not null))
);
create index organization_storage_admissions_usage on public.organization_storage_admissions(organization_id,state);
create index m15_license_history on public.audit_logs(organization_id,chain_sequence desc) where action like 'licensing.%';
alter table public.organization_license_states enable row level security;
alter table public.organization_storage_admissions enable row level security;
revoke all on public.organization_license_states,public.organization_storage_admissions from public,anon,authenticated,service_role;
grant select on public.organization_license_states,public.organization_storage_admissions to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('licence-artifacts','licence-artifacts',false,32768,array['application/jose','application/octet-stream']) on conflict(id) do nothing;

-- Preserve the projector's existing behavior; add only typed licence provenance.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.m13_01_project_v2_audit_json(jsonb)'::regprocedure);
 if position('licenseArtifactDigest' in definition)=0 then
 definition:=replace(definition,'if v_key in (','if v_key in (''licenseArtifactDigest'',''licenseRequestDigest'') and v_text ~ ''^[a-f0-9]{64}$'' then v_result:=v_result||jsonb_build_object(v_key,v_value); elsif v_key in (');
 execute definition;
 end if;
end $$;

create function public.m15_01_actor_can(p_organization_id uuid,p_actor_user_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select case when jsonb_typeof(o.permissions->p_permission)='boolean' then (o.permissions->>p_permission)::boolean
 else m.role in ('owner','admin') or exists(select 1 from public.user_role_assignments a join public.custom_roles r on r.id=a.role_id and r.organization_id=a.organization_id
 where a.organization_id=m.organization_id and a.user_id=m.user_id and r.is_active and not r.is_deleted and r.permissions->p_permission='true'::jsonb) end
 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active and u.email_verified_at is not null
 join public.organizations org on org.id=m.organization_id and org.is_active
 left join public.base_role_permission_overrides o on o.organization_id=m.organization_id and o.base_role=m.role
 where m.organization_id=p_organization_id and m.user_id=p_actor_user_id),false)
$$;
create function public.m15_01_lock(p_organization_id uuid) returns void language sql volatile set search_path=pg_catalog,public as $$
 select pg_advisory_xact_lock(hashtextextended('m15:'||p_organization_id::text,0)) $$;
create function public.m15_01_usage(p_organization_id uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object(
 'activeMembers',(select count(*) from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id),
 'reservedInvitations',(select count(distinct lower(i.email)) from public.invitations i where i.organization_id=p_organization_id and i.status='pending' and i.expires_at>clock_timestamp()
 and not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=i.organization_id and lower(u.email)=lower(i.email))),
 'products',(select count(*) from public.products where organization_id=p_organization_id and archived_at is null),
 'storageBytes',(select coalesce(sum(observed_bytes),0) from public.organization_storage_admissions where organization_id=p_organization_id and state='completed'),
 'storageReservedBytes',(select coalesce(sum(reserved_bytes),0) from public.organization_storage_admissions where organization_id=p_organization_id and state in ('reserved','uploading','uncertain')),
 'protectedStorageBytes',(select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end),0) from storage.objects where name like p_organization_id::text||'/%' and bucket_id in ('audit-exports','filtered-exports','technical-file-snapshot-exports','technical-file-declarations','tenant-exports','evidence-watermark-exports')))
$$;
create function public.m15_01_get_state(p_organization_id uuid,p_actor_user_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) then return jsonb_build_object('outcome','forbidden');end if;
 return jsonb_build_object('state',(select to_jsonb(s) from public.organization_license_states s where organization_id=p_organization_id),'usage',public.m15_01_usage(p_organization_id),'lastRejected',(select jsonb_build_object('reason',after_redacted->>'reasonCode','occurredAt',created_at) from public.audit_logs where organization_id=p_organization_id and action='licensing.activation' and outcome='denied' order by chain_sequence desc limit 1),'storageAccountingReady',coalesce((select storage_accounting_ready from public.organization_license_states where organization_id=p_organization_id),false));
end $$;
create function public.m15_01_checkpoint_time(p_organization_id uuid,p_actor_user_id uuid,p_observed_at timestamptz) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.organization_license_states%rowtype;begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) then raise exception 'licensing_forbidden' using errcode='42501';end if;
 if p_observed_at is null then raise exception 'invalid_time' using errcode='22023';end if;
 perform public.m15_01_lock(p_organization_id);
 update public.organization_license_states set clock_rollback_detected=clock_rollback_detected or p_observed_at<time_high_water_at-interval '5 minutes',time_high_water_at=greatest(time_high_water_at,p_observed_at),updated_at=clock_timestamp() where organization_id=p_organization_id returning * into s;
 return jsonb_build_object('timeHighWaterAt',s.time_high_water_at,'clockRollbackDetected',coalesce(s.clock_rollback_detected,false));
end $$;
create function public.m15_01_activate(p_organization_id uuid,p_actor_user_id uuid,p_artifact text,p_artifact_digest text,p_verified_claims jsonb,p_expected_version integer,p_idempotency_key uuid,p_request_digest text,p_rejection_reason text default null,p_artifact_object_path text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.organization_license_states%rowtype;a public.audit_logs%rowtype;v_version integer;v_audit uuid;v_outcome text;v_cutoff timestamptz;begin
 if not public.m15_01_actor_can(p_organization_id,p_actor_user_id,'can_manage_licensing') then return jsonb_build_object('outcome','forbidden');end if;
 if p_idempotency_key is null or p_expected_version<0 or p_artifact_digest !~ '^[a-f0-9]{64}$' or p_request_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid_licence_command' using errcode='22023';end if;
 perform public.m15_01_lock(p_organization_id);
 perform 1 from public.users where id=p_actor_user_id and is_active and email_verified_at is not null for share;
 if not found or not public.m15_01_actor_can(p_organization_id,p_actor_user_id,'can_manage_licensing') then return jsonb_build_object('outcome','forbidden');end if;
 select * into s from public.organization_license_states where organization_id=p_organization_id for update;v_version:=coalesce(s.version,0);
 select * into a from public.audit_logs where organization_id=p_organization_id and event_key='licensing.activate:'||p_idempotency_key::text;
 if found then
 if a.actor_id<>p_actor_user_id::text or a.after_redacted->>'licenseRequestDigest'<>p_request_digest then return jsonb_build_object('outcome','conflict','version',v_version);end if;
 return jsonb_build_object('outcome',case when a.outcome='denied' then 'rejected' else 'replayed' end,'version',(a.after_redacted->>'version')::integer,'auditId',a.id);end if;
 if v_version<>p_expected_version then return jsonb_build_object('outcome','conflict','version',v_version);end if;
 if p_rejection_reason is null then
 if p_artifact is null or octet_length(p_artifact)>32768 or p_verified_claims is null or p_verified_claims->>'organizationId'<>p_organization_id::text
 or p_artifact_object_path is distinct from p_organization_id::text||'/'||p_artifact_digest||'.jws'
 or not exists(select 1 from storage.objects where bucket_id='licence-artifacts' and name=p_artifact_object_path)
 or (p_verified_claims->>'sequence')::bigint<=coalesce(s.issuance_sequence,0)
 or (p_verified_claims->>'graceDays')::integer<>30
 or (p_verified_claims->>'issuedAt')::timestamptz>(p_verified_claims->>'startsAt')::timestamptz
 or (p_verified_claims->>'startsAt')::timestamptz>=(p_verified_claims->>'expiresAt')::timestamptz
 or (p_verified_claims->>'startsAt')::timestamptz>clock_timestamp()
 or (p_verified_claims->>'expiresAt')::timestamptz+interval '30 days'<=clock_timestamp()
 then raise exception 'invalid_verified_licence' using errcode='22023';end if;
 v_cutoff:=case when s.organization_id is null then null when not((p_verified_claims->'entitlements') @> (s.verified_claims->'entitlements')) then clock_timestamp() else s.protected_regulatory_cutoff end;
 insert into public.organization_license_states(organization_id,artifact,artifact_digest,artifact_object_path,verified_claims,issuance_sequence,version,time_high_water_at,protected_regulatory_cutoff,storage_accounting_ready)
 values(p_organization_id,p_artifact,p_artifact_digest,p_artifact_object_path,p_verified_claims,(p_verified_claims->>'sequence')::bigint,v_version+1,clock_timestamp(),v_cutoff,public.m15_01_storage_accounting_ready(p_organization_id))
 on conflict(organization_id) do update set artifact=excluded.artifact,artifact_digest=excluded.artifact_digest,artifact_object_path=excluded.artifact_object_path,verified_claims=excluded.verified_claims,issuance_sequence=excluded.issuance_sequence,version=excluded.version,time_high_water_at=greatest(organization_license_states.time_high_water_at,excluded.time_high_water_at),protected_regulatory_cutoff=excluded.protected_regulatory_cutoff,updated_at=clock_timestamp();
 v_version:=v_version+1;
 elsif p_rejection_reason !~ '^[a-z][a-z0-9_]{0,79}$' then raise exception 'invalid_rejection_reason' using errcode='22023';end if;
 select x.outcome,x.audit_id into v_outcome,v_audit from public.m13_01_append_audit_event(p_organization_id,'organization','licensing.activate:'||p_idempotency_key::text,'user',p_actor_user_id::text,
 'licensing.activation', 'organization_license',p_organization_id::text,case when p_rejection_reason is null then 'completed' else 'denied' end,p_idempotency_key,
 case when s.organization_id is not null then jsonb_build_object('licenseArtifactDigest',s.artifact_digest,'version',s.version) else null end,
 jsonb_build_object('licenseArtifactDigest',p_artifact_digest,'licenseRequestDigest',p_request_digest,'version',v_version,'reasonCode',coalesce(p_rejection_reason,'activated')),
 p_rejection_reason,null,null,p_actor_user_id) x;
 if v_outcome not in ('inserted','replayed') then raise exception 'licence_audit_conflict' using errcode='40001';end if;
 return jsonb_build_object('outcome',case when p_rejection_reason is null then 'activated' else 'rejected' end,'version',v_version,'auditId',v_audit);
end $$;
create function public.m15_01_history(p_organization_id uuid,p_actor_user_id uuid,p_limit integer default 20,p_cursor bigint default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare rows jsonb;begin
 if not public.m15_01_actor_can(p_organization_id,p_actor_user_id,'can_view_licensing') then raise exception 'licensing_forbidden' using errcode='42501';end if;
 if p_limit not between 1 and 100 or p_cursor<1 then raise exception 'invalid_history_page' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sequence',chain_sequence,'action',action,'outcome',outcome,'reason',reason,'createdAt',created_at,'artifactDigest',after_redacted->>'licenseArtifactDigest','version',(after_redacted->>'version')::integer) order by chain_sequence desc),'[]') into rows
 from(select * from public.audit_logs where organization_id=p_organization_id and action='licensing.activation' and (p_cursor is null or chain_sequence<p_cursor) order by chain_sequence desc limit p_limit) q;
 return jsonb_build_object('items',rows,'nextCursor',case when jsonb_array_length(rows)=p_limit then rows->(p_limit-1)->>'sequence' else null end);
end $$;
-- Source-owned transactions use this assertion before their customer side effect.
create function public.m15_01_assert_customer_write(p_organization_id uuid,p_capability text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.organization_license_states%rowtype;n timestamptz:=clock_timestamp();begin
 perform public.m15_01_lock(p_organization_id);
 select * into s from public.organization_license_states where organization_id=p_organization_id for update;
 if not found or s.clock_rollback_detected or n<s.time_high_water_at-interval '5 minutes' or n<(s.verified_claims->>'startsAt')::timestamptz
 or greatest(n,s.time_high_water_at)>=(s.verified_claims->>'expiresAt')::timestamptz+interval '30 days' or not(s.verified_claims->'entitlements' ? p_capability)
 then raise exception 'licensing_customer_write_denied' using errcode='42501';end if;
 update public.organization_license_states set time_high_water_at=greatest(time_high_water_at,n) where organization_id=p_organization_id;
end $$;
create function public.m15_01_resolve_upload_owner(p_bucket text,p_object_path text,p_bytes bigint,p_source_context jsonb) returns uuid language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o uuid;begin
 if p_source_context->>'kind'='supplier_evidence' then
 select v.organization_id into o from public.evidence_document_versions v join public.supplier_evidence_submissions s on s.organization_id=v.organization_id and s.evidence_version_id=v.id and s.state='uploading'
 join public.supplier_evidence_invitations i on i.organization_id=s.organization_id and i.id=s.invitation_id and i.state='used' and i.session_expires_at>clock_timestamp()
 join public.supplier_evidence_requests r on r.organization_id=s.organization_id and r.id=s.request_id and r.state='open'
 where i.session_token_hash=p_source_context->>'sessionTokenHash' and v.object_bucket=p_bucket and v.object_key=p_object_path and v.declared_size_bytes=p_bytes and v.processing_state='uploading' and v.upload_expires_at>clock_timestamp();
 elsif p_source_context->>'kind'='supplier_sbom' and p_bucket='sbom-originals' then
 select s.organization_id into o from public.sbom_sources s join public.sbom_supplier_submissions sub on sub.organization_id=s.organization_id and sub.source_id=s.id
 join public.sbom_supplier_invitations i on i.organization_id=sub.organization_id and i.id=sub.invitation_id and i.status='used' and i.session_expires_at>clock_timestamp()
 join public.sbom_supplier_requests r on r.organization_id=sub.organization_id and r.id=sub.request_id and r.status='open' and r.expires_at>clock_timestamp()
 where i.session_token_hash=p_source_context->>'sessionTokenHash' and s.staging_storage_key=p_object_path and s.declared_byte_size=p_bytes and s.status='upload_pending' and s.upload_expires_at>clock_timestamp();
 elsif p_source_context->>'kind'='ci' and p_bucket='sbom-originals' then
 select s.organization_id into o from public.sbom_sources s join public.sbom_ci_credentials c on c.organization_id=s.organization_id and c.id=s.actor_credential_id and c.status='active' and c.revoked_at is null
 where c.id::text=p_source_context->>'credentialId' and s.staging_storage_key=p_object_path and s.declared_byte_size=p_bytes and s.status='upload_pending' and s.upload_expires_at>clock_timestamp();
 end if;
 return o;
end $$;
-- Random supplier object paths predate tenant-prefixed paths. Their source FKs,
-- not path text, establish tenant binding.
create function public.m15_01_reserve_storage(p_organization_id uuid,p_actor_user_id uuid,p_operation_id uuid,p_bucket text,p_object_path text,p_bytes bigint,p_token_digest text,p_expires_at timestamptz,p_capability text,p_source_context jsonb default null,p_content_type text default 'application/octet-stream') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o uuid:=p_organization_id;a public.organization_storage_admissions%rowtype;s public.organization_license_states%rowtype;usage bigint;cap bigint;begin
 if p_actor_user_id is null then o:=public.m15_01_resolve_upload_owner(p_bucket,p_object_path,p_bytes,p_source_context);
 if o is null or (p_organization_id is not null and o<>p_organization_id) then return jsonb_build_object('outcome','forbidden');end if;
 elsif p_source_context is not null or not public.m14_04_member(o,p_actor_user_id) or p_object_path not like o::text||'/%' then return jsonb_build_object('outcome','forbidden');end if;
 if p_capability is distinct from (case p_bucket when 'evidence-documents' then 'evidence' when 'sbom-originals' then 'sboms' when 'product-imports' then 'products' when 'security-update-artifacts' then 'products' when 'organization-branding' then 'administration' end) then return jsonb_build_object('outcome','forbidden');end if;
 if p_operation_id is null or p_bytes not between 1 and 9007199254740991 or p_token_digest !~ '^[a-f0-9]{64}$' or p_expires_at not between clock_timestamp() and clock_timestamp()+interval '2 hours' then raise exception 'invalid_storage_admission' using errcode='22023';end if;
 perform public.m15_01_lock(o);
 select * into a from public.organization_storage_admissions where organization_id=o and operation_id=p_operation_id;
 if found then
 if a.actor_user_id is not distinct from p_actor_user_id and a.source_context is not distinct from p_source_context and a.bucket=p_bucket and a.object_path=p_object_path and a.reserved_bytes=p_bytes and a.token_digest=p_token_digest and a.content_type=p_content_type then return jsonb_build_object('outcome','replayed','admissionId',a.id,'operationId',a.operation_id,'organizationId',o);end if;
 return jsonb_build_object('outcome','conflict');end if;
 select * into a from public.organization_storage_admissions where organization_id=o and bucket=p_bucket and object_path=p_object_path for update;
 if found then
 if a.state<>'reserved' or a.actor_user_id is distinct from p_actor_user_id or a.source_context is distinct from p_source_context or a.reserved_bytes<>p_bytes or a.content_type<>p_content_type then return jsonb_build_object('outcome','conflict');end if;
 perform public.m15_01_assert_customer_write(o,p_capability);
 update public.organization_storage_admissions set token_digest=p_token_digest,expires_at=p_expires_at,updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('outcome','replayed','admissionId',a.id,'operationId',a.operation_id,'organizationId',o);
 end if;
 begin perform public.m15_01_assert_customer_write(o,p_capability);exception when insufficient_privilege then return jsonb_build_object('outcome','license_denied');end;
 select * into s from public.organization_license_states where organization_id=o;
 if not s.storage_accounting_ready then return jsonb_build_object('outcome','accounting_unavailable');end if;
 cap:=(s.verified_claims->'limits'->>'storageBytes')::bigint;usage:=(public.m15_01_usage(o)->>'storageBytes')::bigint+(public.m15_01_usage(o)->>'storageReservedBytes')::bigint;
 if cap is not null and (usage>cap or p_bytes>cap-usage) then return jsonb_build_object('outcome','quota_exceeded');end if;
 insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,source_context,bucket,object_path,reserved_bytes,token_digest,expires_at,capability,content_type)
 values(o,p_operation_id,p_actor_user_id,p_source_context,p_bucket,p_object_path,p_bytes,p_token_digest,p_expires_at,p_capability,p_content_type) returning * into a;
 return jsonb_build_object('outcome','reserved','admissionId',a.id,'operationId',a.operation_id,'organizationId',o);
exception when unique_violation then return jsonb_build_object('outcome','conflict');end $$;
create function public.m15_01_claim_storage_upload(p_operation_id uuid,p_token_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;begin
 select * into a from public.organization_storage_admissions where operation_id=p_operation_id and token_digest=p_token_digest for update;
 if not found or a.state<>'reserved' or a.expires_at<=clock_timestamp() then return jsonb_build_object('outcome','conflict');end if;
 if (a.actor_user_id is not null and not public.m14_04_member(a.organization_id,a.actor_user_id)) or (a.actor_user_id is null and public.m15_01_resolve_upload_owner(a.bucket,a.object_path,a.reserved_bytes,a.source_context) is distinct from a.organization_id) then return jsonb_build_object('outcome','forbidden');end if;
 update public.organization_storage_admissions set state='uploading',updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('outcome','claimed','organizationId',a.organization_id,'actorUserId',a.actor_user_id,'bucket',a.bucket,'objectPath',a.object_path,'bytes',a.reserved_bytes,'contentType',a.content_type,'expiresAt',a.expires_at);
end $$;
create function public.m15_01_complete_storage(p_organization_id uuid,p_actor_user_id uuid,p_operation_id uuid,p_token_digest text,p_observed_bytes bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;begin
 perform public.m15_01_lock(p_organization_id);
 select * into a from public.organization_storage_admissions where organization_id=p_organization_id and operation_id=p_operation_id and token_digest=p_token_digest for update;
 if not found or a.actor_user_id is distinct from p_actor_user_id then return jsonb_build_object('outcome','forbidden');end if;
 if (p_actor_user_id is not null and not public.m14_04_member(p_organization_id,p_actor_user_id)) or (p_actor_user_id is null and public.m15_01_resolve_upload_owner(a.bucket,a.object_path,a.reserved_bytes,a.source_context) is distinct from a.organization_id) then return jsonb_build_object('outcome','forbidden');end if;
 if a.state='completed' and a.observed_bytes=p_observed_bytes then return jsonb_build_object('outcome','replayed');end if;
 if a.state<>'uploading' or p_observed_bytes is distinct from a.reserved_bytes then return jsonb_build_object('outcome','conflict');end if;
 update public.organization_storage_admissions set state='completed',observed_bytes=p_observed_bytes,updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('outcome','completed');
end $$;
-- Only growth authorities are triggered. Deletes, audit append and protective
-- maintenance never pass through a generic customer-write trigger.
create function public.m15_01_product_growth() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare cap bigint;used bigint;begin
 if new.archived_at is not null or (tg_op='UPDATE' and old.archived_at is null) then return new;end if;
 perform public.m15_01_assert_customer_write(new.organization_id,'products');
 select (verified_claims->'limits'->>'products')::bigint into cap from public.organization_license_states where organization_id=new.organization_id;
 select count(*) into used from public.products where organization_id=new.organization_id and archived_at is null;
 if cap is not null and used>=cap then raise exception 'licensing_product_limit' using errcode='42501';end if;return new;
end $$;
create trigger m15_product_growth before insert or update of archived_at on public.products for each row execute function public.m15_01_product_growth();
create function public.m15_01_seat_admission(p_organization_id uuid,p_email text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare cap bigint;used bigint;begin
 perform public.m15_01_assert_customer_write(p_organization_id,'administration');
 select (verified_claims->'limits'->>'activeMembers')::bigint into cap from public.organization_license_states where organization_id=p_organization_id;
 select (public.m15_01_usage(p_organization_id)->>'activeMembers')::bigint+(select count(distinct lower(email)) from public.invitations i where organization_id=p_organization_id and status='pending' and expires_at>clock_timestamp() and lower(email)<>lower(p_email)
 and not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=i.organization_id and lower(u.email)=lower(i.email))) into used;
 if cap is not null and used>=cap then raise exception 'licensing_seat_limit' using errcode='42501';end if;
end $$;
create function public.m15_01_member_growth() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare email text;begin
 -- Initial owner establishes verified activation authority; it grants no
 -- product/customer capability and is required to install the first licence.
 if new.role='owner' and not exists(select 1 from public.organization_members where organization_id=new.organization_id) then return new;end if;
 select u.email into email from public.users u where u.id=new.user_id and u.is_active;
 if email is not null then perform public.m15_01_seat_admission(new.organization_id,email);end if;return new;
end $$;
create trigger m15_member_growth before insert on public.organization_members for each row execute function public.m15_01_member_growth();
create function public.m15_01_invitation_growth() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if new.status='pending' and new.expires_at>clock_timestamp() and (tg_op='INSERT' or old.status<>'pending' or old.expires_at<=clock_timestamp()) then
 perform public.m15_01_seat_admission(new.organization_id,new.email);end if;return new;
end $$;
create trigger m15_invitation_growth before insert or update of status,expires_at on public.invitations for each row execute function public.m15_01_invitation_growth();
create function public.m15_01_user_reactivation() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare o uuid;begin
 if new.is_active and not old.is_active then
 for o in select organization_id from public.organization_members where user_id=new.id order by organization_id loop perform public.m15_01_seat_admission(o,new.email);end loop;
 end if;return new;
end $$;
create trigger m15_user_reactivation before update of is_active on public.users for each row execute function public.m15_01_user_reactivation();

create function public.m15_01_customer_write_allowed(p_organization_id uuid,p_capability text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select not clock_rollback_detected and clock_timestamp()>=time_high_water_at-interval '5 minutes' and clock_timestamp()>=(verified_claims->>'startsAt')::timestamptz and greatest(clock_timestamp(),time_high_water_at)<(verified_claims->>'expiresAt')::timestamptz+interval '30 days' and verified_claims->'entitlements' ? p_capability from public.organization_license_states where organization_id=p_organization_id),false)
$$;
create function public.m15_01_get_worker_state(p_organization_id uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('state',(select to_jsonb(s) from public.organization_license_states s where organization_id=p_organization_id),'usage',public.m15_01_usage(p_organization_id),'lastRejected',null,'storageAccountingReady',coalesce((select storage_accounting_ready from public.organization_license_states where organization_id=p_organization_id),false))
$$;
create function public.m15_01_checkpoint_worker_time(p_organization_id uuid,p_observed_at timestamptz) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.organization_license_states%rowtype;begin
 if p_observed_at is null then raise exception 'invalid_time' using errcode='22023';end if;
 perform public.m15_01_lock(p_organization_id);
 update public.organization_license_states set clock_rollback_detected=clock_rollback_detected or p_observed_at<time_high_water_at-interval '5 minutes',time_high_water_at=greatest(time_high_water_at,p_observed_at),updated_at=clock_timestamp() where organization_id=p_organization_id returning * into s;
 return jsonb_build_object('timeHighWaterAt',s.time_high_water_at,'clockRollbackDetected',coalesce(s.clock_rollback_detected,false));
end $$;
create function public.m15_01_validate_storage_upload(p_operation_id uuid,p_token_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;begin
 select * into a from public.organization_storage_admissions where operation_id=p_operation_id and token_digest=p_token_digest;
 if not found or a.state<>'uploading' or a.expires_at<=clock_timestamp()
 or (a.actor_user_id is not null and not public.m14_04_member(a.organization_id,a.actor_user_id))
 or (a.actor_user_id is null and public.m15_01_resolve_upload_owner(a.bucket,a.object_path,a.reserved_bytes,a.source_context) is distinct from a.organization_id)
 then return jsonb_build_object('outcome','forbidden');end if;
 return jsonb_build_object('outcome','authorized');
end $$;
-- Authoritative source references establish object ownership. Generated evidence
-- is excluded; source reservations with unknown sizes remain admission-blocking.
create function public.m15_01_customer_objects() returns table(organization_id uuid,bucket text,object_path text) language sql stable security definer set search_path=pg_catalog,public as $$
 select organization_id,object_bucket,object_key from public.evidence_document_versions
 union select organization_id,'sbom-originals',staging_storage_key from public.sbom_sources
 union select organization_id,storage_bucket,storage_key from public.sbom_raw_objects
 union select organization_id,'organization-branding',object_path from public.organization_branding_assets where object_path is not null
 union select organization_id,'product-imports',source_object_path from public.product_import_jobs where source_deleted_at is null
 union select organization_id,'security-update-artifacts',object_key from public.product_security_update_artifacts where object_key is not null
$$;
create function public.m15_01_storage_accounting_ready(p_organization_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select not exists(select 1 from storage.objects o where o.bucket_id in ('evidence-documents','sbom-originals','organization-branding','product-imports','security-update-artifacts')
 and (o.name like p_organization_id::text||'/%' or exists(select 1 from public.m15_01_customer_objects() c where c.organization_id=p_organization_id and c.bucket=o.bucket_id and c.object_path=o.name))
 and (o.metadata->>'size' is null or o.metadata->>'size' !~ '^[0-9]+$' or not exists(select 1 from public.organization_storage_admissions a where a.organization_id=p_organization_id and a.bucket=o.bucket_id and a.object_path=o.name)))
 and not exists(select 1 from storage.objects o where o.bucket_id in ('evidence-documents','sbom-originals','organization-branding','product-imports','security-update-artifacts') and not exists(select 1 from public.m15_01_customer_objects() c where c.bucket=o.bucket_id and c.object_path=o.name))
$$;
-- Idempotent source+metadata backfill. No storage bytes or source records change.
insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,source_context,bucket,object_path,reserved_bytes,observed_bytes,token_digest,content_type,capability,state,expires_at)
select c.organization_id,o.id,null,jsonb_build_object('kind','existing'),o.bucket_id,o.name,(o.metadata->>'size')::bigint,(o.metadata->>'size')::bigint,repeat('0',64),coalesce(o.metadata->>'mimetype','application/octet-stream'),'evidence','completed',clock_timestamp()
from storage.objects o join public.m15_01_customer_objects() c on c.bucket=o.bucket_id and c.object_path=o.name
where o.metadata->>'size' ~ '^[0-9]+$' and (o.metadata->>'size')::numeric<=9007199254740991
and (select count(distinct owners.organization_id) from public.m15_01_customer_objects() owners where owners.bucket=o.bucket_id and owners.object_path=o.name)=1
on conflict do nothing;
-- Explicit least privilege, including helper functions: SECURITY DEFINER does
-- not mean browser-callable. Source triggers run with their owning authority.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'm15_01_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 if f.signature::text not like '%growth(%' and f.signature::text not like '%reactivation(%' then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
