-- Storage v1.77 compatibility boundary: metadata DELETE and backend deletion
-- execute inside the same database transaction callback, in that order. These
-- transaction locks must remain held until backend deletion and COMMIT finish.
-- A future Storage version must re-verify this ordering before deployment.

create function public.m15_04_lock_retention_writer() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare org uuid;ids uuid[];begin
 if tg_table_name='retention_evidence_classes' then
  select array_agg(distinct organization_id order by organization_id) into ids from public.support_diagnostic_jobs;
 else ids:=array[(to_jsonb(old)->>'organization_id')::uuid,(to_jsonb(new)->>'organization_id')::uuid];end if;
 for org in select distinct x from unnest(ids)x where x is not null order by x loop perform public.m15_01_lock(org);end loop;
 return coalesce(new,old);
end $$;
revoke all on function public.m15_04_lock_retention_writer() from public,anon,authenticated,service_role;
do $$ declare t text;begin
 foreach t in array array['organization_retention_policies','retention_authority_states','retention_authoritative_facts','evidence_document_legal_holds','product_lifecycle_dependency_facts','organization_export_jobs','retention_evidence_classes'] loop
  execute format('create trigger aab_m15_04_retention_lock before insert or update or delete on public.%I for each row execute function public.m15_04_lock_retention_writer()',t);
 end loop;
end $$;

-- Add only the feature-owned, structured per-object deletion receipt action.
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m15_04_audit(public.support_diagnostic_jobs,text,uuid,uuid)'::regprocedure);
 anchor:='''cleanup_requested'',''cleanup_deleted'',''cleanup_failed''';
 if position(anchor in d)=0 then raise exception 'M15-04 cleanup audit action anchor missing';end if;
 execute replace(d,anchor,anchor||',''cleanup_object_deleted''');
 d:=pg_get_functiondef('public.m15_04_audit_receipt_json(uuid,text,text,jsonb)'::regprocedure);
 anchor:='''support.diagnostic.cleanup_failed''';
 if position(anchor in d)=0 then raise exception 'M15-04 cleanup receipt action anchor missing';end if;
 execute replace(d,anchor,anchor||',''support.diagnostic.cleanup_object_deleted''');
end $$;

create function public.m15_04_guard_storage_delete() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare org uuid;job_id uuid;owners integer;j public.support_diagnostic_jobs;r jsonb;begin
 if old.bucket_id<>'support-diagnostics' then return old;end if;
 select count(*),min(organization_id::text)::uuid,min(id::text)::uuid into owners,org,job_id from public.support_diagnostic_jobs where old.name=any(object_paths);
 if owners<>1 then raise exception 'diagnostic_delete_owner_unavailable' using errcode='42501';end if;
 perform public.m15_01_lock(org);
 -- A fresh volatile-trigger command after the common lock sees any writer
 -- which committed before this deletion acquired authority.
 select * into j from public.support_diagnostic_jobs where organization_id=org and id=job_id and old.name=any(object_paths) for share;
 r:=public.m15_04_cleanup_policy(j);
 if not found or j.cleanup_state<>'deleting' or j.cleanup_worker_id is null or j.cleanup_lease_expires_at is null or j.cleanup_lease_expires_at<=clock_timestamp()
 or not coalesce((r->>'eligible')::boolean,false) or r->>'reviewFingerprint' is distinct from j.cleanup_review_fingerprint then
  raise exception 'diagnostic_delete_authority_unavailable' using errcode='42501';
 end if;
 -- Storage object UUID is a structural receipt identity; paths never enter it.
 perform public.m15_04_audit(j,'cleanup_object_deleted',old.id);
 return old;
end $$;
revoke all on function public.m15_04_guard_storage_delete() from public,anon,authenticated,service_role;
create trigger aab_m15_04_delete_authority before delete on storage.objects for each row execute function public.m15_04_guard_storage_delete();
