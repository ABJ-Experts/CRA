-- Service-only local verifier projects short-lived runtime authority. Its proof
-- is bound to immutable activation version/digest and explicit trust/config
-- revision; the database never treats a customer-editable setting as a grant.
alter table public.organization_license_states
 add column verification_version integer,
 add column verification_artifact_digest text check(verification_artifact_digest is null or verification_artifact_digest ~ '^[a-f0-9]{64}$'),
 add column verification_valid boolean not null default false,
 add column effective_capabilities jsonb not null default '[]' check(jsonb_typeof(effective_capabilities)='array'),
 add column policy_revision integer not null default 0 check(policy_revision>=0),
 add column configuration_digest text check(configuration_digest is null or configuration_digest ~ '^[a-f0-9]{64}$'),
 add column verification_checked_at timestamptz;
create function public.m15_01_checkpoint_verification(p_organization_id uuid,p_actor_user_id uuid,p_version integer,p_artifact_digest text,p_verified boolean,p_effective_capabilities jsonb,p_policy_revision integer,p_configuration_digest text,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.organization_license_states%rowtype;c text;begin
 if p_actor_user_id is not null and not public.m14_04_member(p_organization_id,p_actor_user_id) then return jsonb_build_object('outcome','forbidden');end if;
 if p_version is null or p_version<1 or p_artifact_digest is null or p_artifact_digest !~ '^[a-f0-9]{64}$' or p_verified is null or p_policy_revision is null or p_policy_revision<1 or p_configuration_digest is null or p_configuration_digest !~ '^[a-f0-9]{64}$' or p_observed_at is null
 or p_effective_capabilities is null or jsonb_typeof(p_effective_capabilities)<>'array' or jsonb_array_length(p_effective_capabilities)>18
 then raise exception 'invalid_runtime_licence_proof' using errcode='22023';end if;
 perform public.m15_01_lock(p_organization_id);
 select * into s from public.organization_license_states where organization_id=p_organization_id for update;
 if not found or s.version<>p_version or s.artifact_digest<>p_artifact_digest then return jsonb_build_object('outcome','stale');end if;
 if p_policy_revision<s.policy_revision or (p_policy_revision=s.policy_revision and s.configuration_digest is not null and s.configuration_digest<>p_configuration_digest) then return jsonb_build_object('outcome','conflict');end if;
 if not p_verified and jsonb_array_length(p_effective_capabilities)<>0 then raise exception 'invalid_runtime_licence_proof' using errcode='22023';end if;
 for c in select jsonb_array_elements_text(p_effective_capabilities) loop
 if c not in ('administration','products','sboms','vulnerabilities','findings','reporting','technical_files','evidence','suppliers','frameworks','connectors','tasks','notifications','dashboards','scheduled_reports','portfolio','ai') or not(s.verified_claims->'entitlements' ? c) then raise exception 'unlicensed_runtime_capability' using errcode='22023';end if;
 end loop;
 if jsonb_array_length(p_effective_capabilities)<>(select count(distinct value) from jsonb_array_elements_text(p_effective_capabilities)) then raise exception 'duplicate_runtime_capability' using errcode='22023';end if;
 update public.organization_license_states set verification_version=p_version,verification_artifact_digest=p_artifact_digest,verification_valid=p_verified,effective_capabilities=p_effective_capabilities,policy_revision=p_policy_revision,configuration_digest=p_configuration_digest,verification_checked_at=clock_timestamp(),updated_at=clock_timestamp()
 where organization_id=p_organization_id;
 return jsonb_build_object('outcome','updated');
end $$;
create or replace function public.m15_01_customer_write_allowed(p_organization_id uuid,p_capability text) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select verification_valid and verification_version=version and verification_artifact_digest=artifact_digest and policy_revision>=1
 and verification_checked_at>clock_timestamp()-interval '60 seconds' and verification_checked_at<=clock_timestamp()+interval '5 minutes'
 and effective_capabilities ? p_capability and verified_claims->'entitlements' ? p_capability
 and not clock_rollback_detected and clock_timestamp()>=time_high_water_at-interval '5 minutes'
 and clock_timestamp()>=(verified_claims->>'startsAt')::timestamptz
 and greatest(clock_timestamp(),time_high_water_at)<(verified_claims->>'expiresAt')::timestamptz+interval '30 days'
 from public.organization_license_states where organization_id=p_organization_id),false)
$$;
create or replace function public.m15_01_assert_customer_write(p_organization_id uuid,p_capability text) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 perform public.m15_01_lock(p_organization_id);
 perform 1 from public.organization_license_states where organization_id=p_organization_id for update;
 if not public.m15_01_customer_write_allowed(p_organization_id,p_capability) then raise exception 'licensing_customer_write_denied' using errcode='42501';end if;
 update public.organization_license_states set time_high_water_at=greatest(time_high_water_at,clock_timestamp()) where organization_id=p_organization_id;
end $$;
create function public.m15_01_checkpoint_clock(p_organization_id uuid,p_observed_at timestamptz,p_actor_user_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.organization_license_states%rowtype;k uuid:=gen_random_uuid();a text;begin
 if p_observed_at is null then raise exception 'invalid_time' using errcode='22023';end if;
 perform public.m15_01_lock(p_organization_id);
 select * into s from public.organization_license_states where organization_id=p_organization_id for update;
 if not found then return jsonb_build_object('timeHighWaterAt',null,'clockRollbackDetected',false);end if;
 if s.clock_rollback_detected and p_observed_at>=s.time_high_water_at and clock_timestamp()>=s.time_high_water_at then
 select outcome into a from public.m13_01_append_audit_event(p_organization_id,'organization','licensing.clock_restored:'||k::text,
 case when p_actor_user_id is null then 'system' else 'user' end,coalesce(p_actor_user_id::text,'licensing-clock'),
 'licensing.clock_restored','organization_license',p_organization_id::text,'completed',k,
 jsonb_build_object('state','clock_untrusted'),jsonb_build_object('state','clock_restored'),'clock_caught_up',null,null,p_actor_user_id);
 if a<>'inserted' then raise exception 'licensing_clock_audit_conflict' using errcode='40001';end if;
 s.clock_rollback_detected:=false;
 end if;
 update public.organization_license_states set clock_rollback_detected=s.clock_rollback_detected or p_observed_at<s.time_high_water_at-interval '5 minutes',time_high_water_at=greatest(s.time_high_water_at,p_observed_at),updated_at=clock_timestamp() where organization_id=p_organization_id returning * into s;
 return jsonb_build_object('timeHighWaterAt',s.time_high_water_at,'clockRollbackDetected',s.clock_rollback_detected);
end $$;
create or replace function public.m15_01_checkpoint_time(p_organization_id uuid,p_actor_user_id uuid,p_observed_at timestamptz) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) then raise exception 'licensing_forbidden' using errcode='42501';end if;
 return public.m15_01_checkpoint_clock(p_organization_id,p_observed_at,p_actor_user_id);
end $$;
create or replace function public.m15_01_checkpoint_worker_time(p_organization_id uuid,p_observed_at timestamptz) returns jsonb language sql security definer set search_path=pg_catalog,public as $$
 select public.m15_01_checkpoint_clock(p_organization_id,p_observed_at,null)
$$;
revoke all on function public.m15_01_checkpoint_verification(uuid,uuid,integer,text,boolean,jsonb,integer,text,timestamptz),public.m15_01_checkpoint_clock(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.m15_01_checkpoint_verification(uuid,uuid,integer,text,boolean,jsonb,integer,text,timestamptz) to service_role;
-- Upload authority retains source permissions through publication, including
-- revoked custom grants. Legacy evidence keys use random UUID components;
-- source ownership, not a string prefix, supplies their tenant boundary.
create function public.m15_01_member_upload_allowed(p_organization_id uuid,p_actor_user_id uuid,p_bucket text,p_object_path text,p_bytes bigint) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$ begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) then return false;end if;
 if p_bucket='evidence-documents' then
 return public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_upload_evidence') and exists(select 1 from public.evidence_document_versions v where v.organization_id=p_organization_id and v.uploader_user_id=p_actor_user_id and v.object_bucket=p_bucket and v.object_key=p_object_path and v.declared_size_bytes=p_bytes and v.processing_state='uploading');
 elsif p_bucket='sbom-originals' then
 return public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_upload_sboms') and exists(select 1 from public.sbom_sources s where s.organization_id=p_organization_id and s.actor_user_id=p_actor_user_id and s.staging_storage_key=p_object_path and s.declared_byte_size=p_bytes and s.status='upload_pending');
 elsif p_bucket='security-update-artifacts' then
 return public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_edit_products') and exists(select 1 from public.product_security_update_artifacts a where a.organization_id=p_organization_id and a.created_by=p_actor_user_id and a.object_key=p_object_path and a.byte_size=p_bytes and a.upload_status='reserved');
 elsif p_bucket='organization-branding' then
 return public.m1_v2_is_active_organization_owner(p_organization_id,p_actor_user_id) and exists(select 1 from public.organization_branding_assets a where a.organization_id=p_organization_id and a.created_by=p_actor_user_id and a.state='reserved' and p_object_path ~ ('^'||p_organization_id::text||'/'||a.id::text||'/[a-f0-9]{64}\.webp$'));
 elsif p_bucket='product-imports' then
 -- Source CSV is written before create_product_import_job. Its bounded owner
 -- reservation is the durable authority until that source transaction commits.
 return public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_create_products') and public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_edit_products') and p_object_path ~ ('^'||p_organization_id::text||'/[a-f0-9-]{36}/source\.csv$') and p_bytes<=10485760;
 end if;return false;
end $$;
do $$ declare d text;sig regprocedure;begin
 sig:='public.m15_01_reserve_storage(uuid,uuid,uuid,text,text,bigint,text,timestamptz,text,jsonb,text)'::regprocedure;d:=pg_get_functiondef(sig);
 if position('not public.m14_04_member(o,p_actor_user_id) or p_object_path not like o::text||''/%''' in d)=0 then raise exception 'licensing_reserve_source_drift';end if;
 d:=replace(d,'not public.m14_04_member(o,p_actor_user_id) or p_object_path not like o::text||''/%''','not public.m15_01_member_upload_allowed(o,p_actor_user_id,p_bucket,p_object_path,p_bytes)');execute d;
 for sig in select unnest(array['public.m15_01_claim_storage_upload(uuid,text)'::regprocedure,'public.m15_01_validate_storage_upload(uuid,text)'::regprocedure,'public.m15_01_complete_storage(uuid,uuid,uuid,text,bigint)'::regprocedure]) loop
 d:=pg_get_functiondef(sig);
 d:=replace(d,'not public.m14_04_member(a.organization_id,a.actor_user_id)','not public.m15_01_member_upload_allowed(a.organization_id,a.actor_user_id,a.bucket,a.object_path,a.reserved_bytes)');
 d:=replace(d,'not public.m14_04_member(p_organization_id,p_actor_user_id)','not public.m15_01_member_upload_allowed(p_organization_id,p_actor_user_id,a.bucket,a.object_path,a.reserved_bytes)');execute d;
 end loop;
end $$;
create function public.m15_01_reset_storage_upload(p_operation_id uuid,p_token_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;begin
 select * into a from public.organization_storage_admissions where operation_id=p_operation_id and token_digest=p_token_digest for update;
 if not found or a.state<>'uploading' or exists(select 1 from storage.objects where bucket_id=a.bucket and name=a.object_path) then return jsonb_build_object('outcome','forbidden');end if;
 if (a.actor_user_id is not null and not public.m15_01_member_upload_allowed(a.organization_id,a.actor_user_id,a.bucket,a.object_path,a.reserved_bytes)) or (a.actor_user_id is null and public.m15_01_resolve_upload_owner(a.bucket,a.object_path,a.reserved_bytes,a.source_context) is distinct from a.organization_id) then return jsonb_build_object('outcome','forbidden');end if;
 update public.organization_storage_admissions set state='reserved',updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('outcome','reserved');
end $$;
revoke all on function public.m15_01_member_upload_allowed(uuid,uuid,text,text,bigint),public.m15_01_reset_storage_upload(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.m15_01_reset_storage_upload(uuid,text) to service_role;

do $$ declare d text;begin
 d:=pg_get_functiondef('public.m15_01_activate(uuid,uuid,text,text,jsonb,integer,uuid,text,text,text)'::regprocedure);
 d:=replace(d,'p_expected_version<0 or p_artifact_digest !~','p_expected_version is null or p_expected_version<0 or p_artifact_digest is null or p_request_digest is null or p_artifact_digest !~');
 d:=replace(d,' perform public.m15_01_lock(p_organization_id);
 perform 1 from public.users where id=p_actor_user_id and is_active and email_verified_at is not null for share;',
 ' perform 1 from public.users where id=p_actor_user_id and is_active and email_verified_at is not null for share;');
 d:=replace(d,'select * into s from public.organization_license_states where organization_id=p_organization_id for update;v_version',
 'perform public.m15_01_lock(p_organization_id); select * into s from public.organization_license_states where organization_id=p_organization_id for update;v_version');
 execute d;
end $$;

do $$ declare d text;begin
 d:=pg_get_functiondef('public.m15_01_history(uuid,uuid,integer,bigint)'::regprocedure);
 d:=replace(d,'if p_limit not between 1 and 100','if p_limit is null or p_limit not between 1 and 100');execute d;
end $$;
