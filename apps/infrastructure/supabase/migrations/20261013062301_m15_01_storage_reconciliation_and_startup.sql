-- Additive reconciliation and startup helpers; preserves the applied runtime migration.
create function public.m15_01_policy_tenants(p_limit integer default 100,p_after uuid default null) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ids jsonb;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_policy_tenant_page' using errcode='22023';end if;
 select coalesce(jsonb_agg(organization_id order by organization_id),'[]') into ids from(select organization_id from public.organization_license_states where p_after is null or organization_id>p_after order by organization_id limit p_limit) q;
 return jsonb_build_object('organizationIds',ids,'nextCursor',case when jsonb_array_length(ids)=p_limit then ids->>(p_limit-1) else null end);
end $$;
alter table public.organization_storage_admissions add column content_sha256 text check(content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$');
create function public.m15_01_prepare_storage_publication(p_operation_id uuid,p_token_digest text,p_sha256 text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;begin
 if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'invalid_upload_hash' using errcode='22023';end if;
 select * into a from public.organization_storage_admissions where operation_id=p_operation_id and token_digest=p_token_digest for update;
 if not found or public.m15_01_validate_storage_upload(p_operation_id,p_token_digest)->>'outcome'<>'authorized' or (a.content_sha256 is not null and a.content_sha256<>p_sha256) then return jsonb_build_object('outcome','forbidden');end if;
 update public.organization_storage_admissions set content_sha256=p_sha256,updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('outcome','authorized');
end $$;
-- Metadata is written by the bounded uploader only after computing the streamed
-- hash. A completion/reconcile never assumes that a successful network request
-- proves that the expected tenant object was actually published.
create function public.m15_01_storage_object_matches(p_admission public.organization_storage_admissions) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select p_admission.content_sha256 is not null and exists(select 1 from storage.objects o where o.bucket_id=p_admission.bucket and o.name=p_admission.object_path
 and o.metadata->>'size' ~ '^[0-9]+$' and (o.metadata->>'size')::numeric=p_admission.reserved_bytes
 and o.user_metadata->>'sha256'=p_admission.content_sha256 and o.user_metadata->>'operationId'=p_admission.operation_id::text)
$$;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.m15_01_complete_storage(uuid,uuid,uuid,text,bigint)'::regprocedure);
 if position('if a.state<>''uploading'' or p_observed_bytes is distinct from a.reserved_bytes' in d)=0 then raise exception 'licensing_complete_source_drift';end if;
 d:=replace(d,'if a.state<>''uploading'' or p_observed_bytes is distinct from a.reserved_bytes','if a.state<>''uploading'' or p_observed_bytes is distinct from a.reserved_bytes or not public.m15_01_storage_object_matches(a)');execute d;
 d:=pg_get_functiondef('public.m15_01_reset_storage_upload(uuid,text)'::regprocedure);
 d:=replace(d,'set state=''reserved'',updated_at','set state=''reserved'',content_sha256=null,updated_at');execute d;
 d:=pg_get_functiondef('public.m15_01_reserve_storage(uuid,uuid,uuid,text,text,bigint,text,timestamptz,text,jsonb,text)'::regprocedure);
 d:=replace(d,'p_bytes not between 1 and 9007199254740991','p_bytes not between 1 and (case p_bucket when ''evidence-documents'' then 52428800 when ''sbom-originals'' then 104857600 when ''product-imports'' then 10485760 when ''organization-branding'' then 2097152 when ''security-update-artifacts'' then 2147483647 else 0 end)');execute d;
end $$;
create function public.m15_01_reconcile_storage_upload(p_operation_id uuid,p_token_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;begin
 select * into a from public.organization_storage_admissions where operation_id=p_operation_id and token_digest=p_token_digest for update;
 if not found then return jsonb_build_object('outcome','forbidden');end if;
 if a.state='completed' then return jsonb_build_object('outcome','replayed');end if;
 if a.state not in ('uploading','uncertain') then return jsonb_build_object('outcome','forbidden');end if;
 if public.m15_01_storage_object_matches(a) then
 update public.organization_storage_admissions set state='completed',observed_bytes=reserved_bytes,updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('outcome','completed');end if;
 update public.organization_storage_admissions set state='uncertain',updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('outcome','uncertain');
end $$;
create function public.m15_01_release_storage(p_organization_id uuid,p_actor_user_id uuid,p_bucket text,p_object_path text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;allowed boolean:=false;k uuid:=gen_random_uuid();result text;begin
 perform public.m15_01_lock(p_organization_id);
 select * into a from public.organization_storage_admissions where organization_id=p_organization_id and bucket=p_bucket and object_path=p_object_path for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 if a.state='released' then return jsonb_build_object('outcome','replayed');end if;
 if exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_object_path) then return jsonb_build_object('outcome','conflict');end if;
 if p_actor_user_id is not null then allowed:=a.actor_user_id=p_actor_user_id and public.m14_04_member(p_organization_id,p_actor_user_id);
 else
 allowed:=case p_bucket
 when 'evidence-documents' then exists(select 1 from public.evidence_document_deletion_cleanup_items c where c.organization_id=p_organization_id and c.object_bucket=p_bucket and c.object_key=p_object_path and c.state='deleted')
 when 'product-imports' then not exists(select 1 from public.product_import_jobs j where j.organization_id=p_organization_id and j.source_object_path=p_object_path and j.source_deleted_at is null)
 when 'organization-branding' then exists(select 1 from public.organization_branding_assets b where b.organization_id=p_organization_id and b.state in ('failed','removed') and p_object_path ~ ('^'||p_organization_id::text||'/'||b.id::text||'/[a-f0-9]{64}\.webp$'))
 when 'security-update-artifacts' then exists(select 1 from public.product_security_update_artifacts s where s.organization_id=p_organization_id and s.object_key=p_object_path and s.cleanup_completed_at is not null)
 else false end;
 end if;
 if not coalesce(allowed,false) then return jsonb_build_object('outcome','forbidden');end if;
 select outcome into result from public.m13_01_append_audit_event(p_organization_id,'organization','licensing.storage_released:'||a.id::text,case when p_actor_user_id is null then 'system' else 'user' end,coalesce(p_actor_user_id::text,'licensing-storage'),
 'licensing.storage_released','storage_admission',a.id::text,'completed',k,jsonb_build_object('artifactId',a.id,'state',a.state),jsonb_build_object('artifactId',a.id,'state','released'),'confirmed_source_cleanup',null,null,p_actor_user_id);
 if result not in ('inserted','replayed') then raise exception 'licensing_storage_audit_conflict' using errcode='40001';end if;
 update public.organization_storage_admissions set state='released',updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('outcome','released');
end $$;
create function public.m15_01_reconcile_abandoned_reservations(p_organization_id uuid,p_limit integer default 100) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.organization_storage_admissions%rowtype;k uuid;result text;n integer:=0;begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_reservation_page' using errcode='22023';end if;
 perform public.m15_01_lock(p_organization_id);
 for a in select * from public.organization_storage_admissions where organization_id=p_organization_id and state='reserved' and expires_at<clock_timestamp() and not exists(select 1 from storage.objects where bucket_id=bucket and name=object_path) order by expires_at,id limit p_limit for update skip locked loop
 k:=gen_random_uuid();
 select outcome into result from public.m13_01_append_audit_event(p_organization_id,'organization','licensing.storage_released:'||a.id::text,'system','licensing-storage','licensing.storage_released','storage_admission',a.id::text,'completed',k,jsonb_build_object('artifactId',a.id,'state','reserved'),jsonb_build_object('artifactId',a.id,'state','released'),'expired_never_started',null,null,null);
 if result not in ('inserted','replayed') then raise exception 'licensing_storage_audit_conflict' using errcode='40001';end if;
 update public.organization_storage_admissions set state='released',updated_at=clock_timestamp() where id=a.id;n:=n+1;
 end loop;return n;
end $$;
revoke all on function public.m15_01_policy_tenants(integer,uuid),public.m15_01_prepare_storage_publication(uuid,text,text),public.m15_01_storage_object_matches(public.organization_storage_admissions),public.m15_01_reconcile_storage_upload(uuid,text),public.m15_01_release_storage(uuid,uuid,text,text),public.m15_01_reconcile_abandoned_reservations(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.m15_01_policy_tenants(integer,uuid),public.m15_01_prepare_storage_publication(uuid,text,text),public.m15_01_reconcile_storage_upload(uuid,text),public.m15_01_release_storage(uuid,uuid,text,text),public.m15_01_reconcile_abandoned_reservations(uuid,integer) to service_role;
