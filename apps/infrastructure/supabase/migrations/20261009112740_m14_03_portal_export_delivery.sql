-- M14-03: independent external subjects reuse the same bounded export pipeline.
-- Existing supplier/auditor tokens, grants, decisions and retention are unchanged.
alter table public.export_jobs add constraint export_jobs_supplier_tenant_fk foreign key(organization_id,supplier_invitation_id) references public.supplier_evidence_invitations(organization_id,id) on delete restrict;
create function public.m14_03_portal_principal(p_subject_kind text,p_session_digest text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
 if p_session_digest is null or p_session_digest !~ '^[a-f0-9]{64}$' then raise exception 'export_access_denied' using errcode='42501'; end if;
 if p_subject_kind='supplier_session' then
 select jsonb_build_object('organizationId',i.organization_id,'subjectId',i.id,'expiresAt',i.session_expires_at,'requestId',i.request_id,'revisionId',i.revision_id,'productId',q.product_id)
 into v_result from public.supplier_evidence_invitations i
 join public.supplier_evidence_requests q on q.organization_id=i.organization_id and q.id=i.request_id and q.state='open'
 join public.organizations o on o.id=i.organization_id and o.is_active
 join public.products p on p.organization_id=q.organization_id and p.id=q.product_id
 where i.session_token_hash=p_session_digest and i.state='used' and i.revoked_at is null and i.session_expires_at>clock_timestamp();
 elsif p_subject_kind='auditor_session' then
 select jsonb_build_object('organizationId',g.organization_id,'subjectId',s.id,'expiresAt',least(s.expires_at,g.expires_at),'grantId',g.id,'productId',g.product_id,'snapshotId',g.snapshot_id,'exportId',g.export_id)
 into v_result from public.technical_file_auditor_sessions s
 join public.technical_file_auditor_snapshot_grants g on g.id=s.grant_id and g.status='active' and g.revoked_at is null and g.expires_at>clock_timestamp()
 join public.technical_file_snapshot_exports e on e.organization_id=g.organization_id and e.id=g.export_id and e.snapshot_id=g.snapshot_id and e.status='ready'
 join public.technical_file_snapshots f on f.organization_id=g.organization_id and f.id=g.snapshot_id
 join public.organizations o on o.id=g.organization_id and o.is_active
 join public.products p on p.organization_id=g.organization_id and p.id=g.product_id
 where s.session_token_hash=p_session_digest and s.revoked_at is null and s.expires_at>clock_timestamp();
 end if;
 if v_result is null then raise exception 'export_access_denied' using errcode='42501'; end if;
 return v_result;
end $$;

alter function public.m14_03_job_access(public.export_jobs) rename to m14_03_member_job_access;
create function public.m14_03_job_access(p_job public.export_jobs) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_principal jsonb; v_digest text;
begin
 if p_job.subject_kind='member' then
  if p_job.source in ('supplier_evidence.portal_items','supplier_evidence.portal_submissions','technical_file.auditor_manifest_artifacts') then return false; end if;
  return public.m14_03_member_job_access(p_job);
 elsif p_job.subject_kind='supplier' then
  if p_job.source not in ('supplier_evidence.portal_items','supplier_evidence.portal_submissions') then return false; end if;
  v_principal:=public.m14_03_portal_principal('supplier_session',p_job.supplier_session_digest);
  if (v_principal->>'organizationId')::uuid is distinct from p_job.organization_id or (v_principal->>'subjectId')::uuid is distinct from p_job.supplier_invitation_id then return false; end if;
  if p_job.source='supplier_evidence.portal_submissions' and not exists(select 1 from public.supplier_evidence_request_items x where x.organization_id=p_job.organization_id and x.revision_id=(v_principal->>'revisionId')::uuid and x.id=(p_job.context->>'checklistItemId')::uuid) then return false; end if;
  return true;
 elsif p_job.subject_kind='auditor' then
  if p_job.source<>'technical_file.auditor_manifest_artifacts' then return false; end if;
  select session_token_hash into v_digest from public.technical_file_auditor_sessions where id=p_job.auditor_session_id;
  v_principal:=public.m14_03_portal_principal('auditor_session',v_digest);
  return (v_principal->>'organizationId')::uuid=p_job.organization_id and (v_principal->>'subjectId')::uuid=p_job.auditor_session_id;
 end if;
 return false;
exception when insufficient_privilege or invalid_text_representation then return false;
end $$;

alter function public.m14_03_audit(public.export_jobs,text,uuid) rename to m14_03_member_audit;
create function public.m14_03_audit(p_job public.export_jobs,p_action text,p_request_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_outcome text; v_actor text;
begin
 if p_job.subject_kind='member' then perform public.m14_03_member_audit(p_job,p_action,p_request_id); return; end if;
 v_actor:=case p_job.subject_kind when 'supplier' then 'supplier_portal:'||p_job.supplier_invitation_id::text else 'auditor_session:'||p_job.auditor_session_id::text end;
 select a.outcome into v_outcome from public.m13_01_append_audit_event(p_job.organization_id,'organization','exports.'||p_action||':'||p_request_id::text,
 'system',v_actor,'exports.'||p_action,'export_job',p_job.id::text,'completed',p_request_id,null,
 jsonb_build_object('requestId',p_job.idempotency_key,'subjectKind',p_job.subject_kind,'state',p_job.state,'version',p_job.version),null,null,null,null) a;
 if v_outcome='conflict' then raise exception 'export_audit_conflict' using errcode='23505'; end if;
end $$;

alter function public.m14_03_source_policy(text) rename to m14_03_pre_portal_source_policy;
create function public.m14_03_source_policy(p_source text) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select case p_source
 when 'supplier_evidence.portal_items' then '{"permissions":[],"columns":["id","title","instructions","documentClass","kind","position","reRequestReason"],"page":false,"selected":false}'::jsonb
 when 'supplier_evidence.portal_submissions' then '{"permissions":[],"columns":["id","checklistItemId","state","fileName","mediaType","byteSize","rejectionReason","createdAt","updatedAt"],"page":false,"selected":false}'::jsonb
 when 'technical_file.auditor_manifest_artifacts' then '{"permissions":[],"columns":["kind","fileName","mimeType","byteLength","sha256","generatedAt"],"page":false,"selected":false}'::jsonb
 else public.m14_03_pre_portal_source_policy(p_source) end;
$$;

alter function public.m14_03_source_rows(uuid,uuid,text,jsonb,jsonb) rename to m14_03_pre_portal_source_rows;
create function public.m14_03_source_rows(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs; v_json jsonb; v_row jsonb; v_product uuid; v_grant public.technical_file_auditor_snapshot_grants;
begin
 if p_source not in ('supplier_evidence.portal_items','supplier_evidence.portal_submissions','technical_file.auditor_manifest_artifacts') then
 return query select * from public.m14_03_pre_portal_source_rows(p_organization_id,p_actor_user_id,p_source,p_filters,p_context); return; end if;
 if p_actor_user_id is not null or not p_context ? '_exportJobId' then raise exception 'export_access_denied' using errcode='42501'; end if;
 select * into v_job from public.export_jobs where organization_id=p_organization_id and id=(p_context->>'_exportJobId')::uuid and source=p_source;
 if not found or not public.m14_03_job_access(v_job) then raise exception 'export_access_denied' using errcode='42501'; end if;
 if v_job.subject_kind='supplier' then
 select q.product_id into v_product from public.supplier_evidence_invitations i join public.supplier_evidence_requests q on q.organization_id=i.organization_id and q.id=i.request_id where i.organization_id=p_organization_id and i.id=v_job.supplier_invitation_id;
 v_json:=public.m9_02_portal_json(p_organization_id,v_job.supplier_invitation_id);
 if p_source='supplier_evidence.portal_items' then
  for v_row in select value from jsonb_array_elements(v_json->'items') loop
   return query select v_row->>'id',encode(extensions.digest(convert_to(public.m13_02_canonical_json(v_row),'UTF8'),'sha256'),'hex'),v_product,v_row;
  end loop;
 else
  for v_row in select value from jsonb_array_elements(v_json->'submissions') where value->>'checklistItemId'=v_job.context->>'checklistItemId' loop
   return query select v_row->>'id',coalesce(v_row->>'updatedAt',v_row->>'createdAt'),v_product,v_row;
  end loop;
 end if;
 else
 select g.* into v_grant from public.technical_file_auditor_sessions s join public.technical_file_auditor_snapshot_grants g on g.id=s.grant_id where s.id=v_job.auditor_session_id;
 v_json:=public.m7_snapshot_export_json(p_organization_id,v_grant.export_id);
 for v_row in select value from jsonb_array_elements(v_json->'artifacts') loop
  return query select v_row->>'kind',(select f.payload_sha256 from public.technical_file_snapshots f where f.organization_id=p_organization_id and f.id=v_grant.snapshot_id),v_grant.product_id,v_row;
 end loop;
 end if;
end $$;

alter function public.m14_03_domain_snapshot_access(public.export_jobs) rename to m14_03_pre_portal_snapshot_access;
create function public.m14_03_domain_snapshot_access(p_job public.export_jobs) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if p_job.subject_kind='member' then return public.m14_03_pre_portal_snapshot_access(p_job); end if;
 if not public.m14_03_job_access(p_job) then return false; end if;
 return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id
 and not exists(select 1 from public.m14_03_source_rows(p_job.organization_id,null,p_job.source,'{}',p_job.context||jsonb_build_object('_exportJobId',p_job.id)) s where s.source_id=r.source_id));
end $$;

-- Trusted scope is resolved independently on every public portal operation.
create function public.m14_03_portal_job(p_subject_kind text,p_session_digest text,p_job_id uuid,p_lock boolean default false)
returns public.export_jobs language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_principal jsonb; v_job public.export_jobs;
begin
 v_principal:=public.m14_03_portal_principal(p_subject_kind,p_session_digest);
 if p_lock then select * into v_job from public.export_jobs where organization_id=(v_principal->>'organizationId')::uuid and id=p_job_id for update;
 else select * into v_job from public.export_jobs where organization_id=(v_principal->>'organizationId')::uuid and id=p_job_id; end if;
 if v_job.id is null or (p_subject_kind='supplier_session' and (v_job.subject_kind<>'supplier' or v_job.supplier_invitation_id is distinct from (v_principal->>'subjectId')::uuid or v_job.supplier_session_digest is distinct from p_session_digest))
 or (p_subject_kind='auditor_session' and (v_job.subject_kind<>'auditor' or v_job.auditor_session_id is distinct from (v_principal->>'subjectId')::uuid))
 or not public.m14_03_snapshot_access(v_job) then raise exception 'export_access_denied' using errcode='42501'; end if;
 return v_job;
end $$;

create function public.m14_03_create_portal_export(p_subject_kind text,p_session_digest text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_principal jsonb; v_job public.export_jobs; v_policy jsonb; v_columns jsonb; v_digest text; v_column text; v_org uuid; v_subject uuid;
begin
 v_principal:=public.m14_03_portal_principal(p_subject_kind,p_session_digest); v_org:=(v_principal->>'organizationId')::uuid; v_subject:=(v_principal->>'subjectId')::uuid;
 if p_input is null or jsonb_typeof(p_input) is distinct from 'object' or p_input->>'idempotencyKey' is null or p_input->>'source' is null or p_input->>'format' is null or p_input->>'format' not in ('csv','xlsx') or p_input->>'scope' is distinct from 'all_filtered'
 or p_input->'filters' is distinct from '{}'::jsonb or jsonb_typeof(p_input->'context') is distinct from 'object'
 or(p_subject_kind='supplier_session' and p_input->>'source' not in ('supplier_evidence.portal_items','supplier_evidence.portal_submissions'))
 or(p_subject_kind='auditor_session' and p_input->>'source'<>'technical_file.auditor_manifest_artifacts')
 or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('source','format','scope','filters','context','columns','idempotencyKey')) then raise exception 'invalid_export_request' using errcode='22023'; end if;
 if p_input->>'source'='supplier_evidence.portal_submissions' then
  if (select count(*) from jsonb_object_keys(p_input->'context'))<>1 or not (p_input->'context' ? 'checklistItemId') then raise exception 'invalid_export_context' using errcode='22023'; end if;
 else if p_input->'context'<>'{}'::jsonb then raise exception 'invalid_export_context' using errcode='22023'; end if; end if;
 v_policy:=public.m14_03_source_policy(p_input->>'source');v_columns:=coalesce(p_input->'columns',v_policy->'columns');
 if jsonb_typeof(v_columns)<>'array' or jsonb_array_length(v_columns) not between 1 and 100 or (select count(distinct value) from jsonb_array_elements_text(v_columns))<>jsonb_array_length(v_columns) then raise exception 'invalid_export_columns' using errcode='22023'; end if;
 for v_column in select jsonb_array_elements_text(v_columns) loop if not (v_policy->'columns' ? v_column) then raise exception 'invalid_export_columns' using errcode='22023'; end if; end loop;
 v_digest:=encode(extensions.digest(convert_to(public.m13_02_canonical_json(p_input),'UTF8'),'sha256'),'hex');
 perform 1 from public.organizations where id=v_org for update;
 select * into v_job from public.export_jobs where organization_id=v_org and idempotency_key=(p_input->>'idempotencyKey')::uuid and
 ((p_subject_kind='supplier_session' and subject_kind='supplier' and supplier_invitation_id=v_subject) or(p_subject_kind='auditor_session' and subject_kind='auditor' and auditor_session_id=v_subject));
 if found then
  v_job:=public.m14_03_portal_job(p_subject_kind,p_session_digest,v_job.id);
  if v_job.request_digest<>v_digest then raise exception 'export_idempotency_conflict' using errcode='40001'; end if;return public.m14_03_job_json(v_job);
 end if;
 if(select count(*) from public.export_jobs where organization_id=v_org and state in ('queued','capturing','audit_pending','rendering'))>=10
 or(select count(*) from public.export_jobs where organization_id=v_org and state in ('queued','capturing','audit_pending','rendering') and
 ((p_subject_kind='supplier_session' and supplier_invitation_id=v_subject) or(p_subject_kind='auditor_session' and auditor_session_id=v_subject)))>=2 then raise exception 'export_queue_limit' using errcode='54000'; end if;
 v_job.organization_id:=v_org;v_job.subject_kind:=case p_subject_kind when 'supplier_session' then 'supplier' else 'auditor' end;
 v_job.supplier_invitation_id:=case when p_subject_kind='supplier_session' then v_subject end;
 v_job.supplier_session_digest:=case when p_subject_kind='supplier_session' then p_session_digest end;
 v_job.auditor_session_id:=case when p_subject_kind='auditor_session' then v_subject end;
 v_job.source:=p_input->>'source';v_job.context:=p_input->'context';
 if not public.m14_03_job_access(v_job) then raise exception 'export_access_denied' using errcode='42501'; end if;
 insert into public.export_jobs(organization_id,subject_kind,supplier_invitation_id,supplier_session_digest,auditor_session_id,source,format,scope,filters,context,columns,idempotency_key,request_digest,permission_version,expires_at)
 values(v_org,v_job.subject_kind,v_job.supplier_invitation_id,v_job.supplier_session_digest,v_job.auditor_session_id,v_job.source,p_input->>'format','all_filtered','{}',v_job.context,v_columns,(p_input->>'idempotencyKey')::uuid,v_digest,0,least(clock_timestamp()+interval '24 hours',(v_principal->>'expiresAt')::timestamptz)) returning * into v_job;
 perform public.m14_03_audit(v_job,'queued',v_job.idempotency_key);return public.m14_03_job_json(v_job);
end $$;

create function public.m14_03_get_portal_export(p_subject_kind text,p_session_digest text,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin v_job:=public.m14_03_portal_job(p_subject_kind,p_session_digest,p_job_id);if v_job.expires_at<=clock_timestamp() then v_job.state:='expired';v_job.parts:='[]';end if;return public.m14_03_job_json(v_job);end $$;
create function public.m14_03_list_portal_exports(p_subject_kind text,p_session_digest text,p_query jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_principal jsonb;v_job public.export_jobs;v_data jsonb:='[]';v_limit integer:=coalesce((p_query->>'limit')::integer,25);v_count integer:=0;v_cursor uuid;v_next text;
begin
 v_principal:=public.m14_03_portal_principal(p_subject_kind,p_session_digest);
 if v_limit not between 1 and 100 then raise exception 'invalid_export_limit' using errcode='22023';end if;
 if p_query ? 'cursor' then v_cursor:=(p_query->>'cursor')::uuid;end if;
 for v_job in select * from public.export_jobs where organization_id=(v_principal->>'organizationId')::uuid
 and ((p_subject_kind='supplier_session' and subject_kind='supplier' and supplier_invitation_id=(v_principal->>'subjectId')::uuid and supplier_session_digest=p_session_digest) or(p_subject_kind='auditor_session' and subject_kind='auditor' and auditor_session_id=(v_principal->>'subjectId')::uuid))
 and(not p_query ? 'source' or source=p_query->>'source') and(v_cursor is null or id>v_cursor) order by id loop
 if not public.m14_03_snapshot_access(v_job) then continue;end if;if v_count=v_limit then v_next:=v_data->(v_count-1)->>'id';exit;end if;
 if v_job.expires_at<=clock_timestamp() then v_job.state:='expired';v_job.parts:='[]';end if;v_data:=v_data||jsonb_build_array(public.m14_03_job_json(v_job));v_count:=v_count+1;
 end loop;return jsonb_build_object('data',v_data,'nextCursor',v_next);
end $$;
create function public.m14_03_mutate_portal_export(p_subject_kind text,p_session_digest text,p_job_id uuid,p_expected_version integer,p_idempotency_key uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;v_action text;
begin
 v_job:=public.m14_03_portal_job(p_subject_kind,p_session_digest,p_job_id,true);v_action:=case p_operation when 'cancel' then 'cancelled' when 'retry' then 'retried' end;
 if v_action is null or p_idempotency_key is null then raise exception 'invalid_export_mutation' using errcode='22023';end if;
 if exists(select 1 from public.audit_logs where organization_id=v_job.organization_id and event_key='exports.'||v_action||':'||p_idempotency_key::text and entity_id=p_job_id::text) then return public.m14_03_job_json(v_job);end if;
 if v_job.version<>p_expected_version then raise exception 'export_version_conflict' using errcode='40001';end if;
 if p_operation='cancel' then
 if v_job.state not in ('queued','capturing','audit_pending','rendering','ready') then raise exception 'export_version_conflict' using errcode='40001';end if;
 update public.export_jobs set state='cancelled',worker_id=null,lease_expires_at=null,grant_id=null,grant_digest=null,version=version+1,updated_at=clock_timestamp() where organization_id=v_job.organization_id and id=p_job_id returning * into v_job;
 else
 if v_job.state<>'failed' or v_job.expires_at<=clock_timestamp() or v_job.failure_code not in ('worker_failure','storage_failure','render_failure','capture_timeout','attempts_exhausted','provider_unavailable','storage_unavailable','generation_failed') then raise exception 'export_retry_conflict' using errcode='40001';end if;
 perform 1 from public.organizations where id=v_job.organization_id for update;
 if(select count(*) from public.export_jobs where organization_id=v_job.organization_id and state in ('queued','capturing','audit_pending','rendering'))>=10
 or(select count(*) from public.export_jobs where organization_id=v_job.organization_id and state in ('queued','capturing','audit_pending','rendering') and ((v_job.subject_kind='supplier' and supplier_invitation_id=v_job.supplier_invitation_id) or(v_job.subject_kind='auditor' and auditor_session_id=v_job.auditor_session_id)))>=2 then raise exception 'export_queue_limit' using errcode='54000';end if;
 update public.export_jobs set state='queued',attempts=0,failure_code=null,version=version+1,updated_at=clock_timestamp() where organization_id=v_job.organization_id and id=p_job_id returning * into v_job;
 end if;
 perform public.m14_03_audit(v_job,v_action,p_idempotency_key);return public.m14_03_job_json(v_job);
end $$;
create function public.m14_03_issue_portal_export_download_grant(p_subject_kind text,p_session_digest text,p_job_id uuid,p_artifact_id uuid,p_token_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;v_prefix text;
begin
 v_job:=public.m14_03_portal_job(p_subject_kind,p_session_digest,p_job_id,true);
 if v_job.state<>'ready' or v_job.expires_at<=clock_timestamp() or not exists(select 1 from jsonb_array_elements(v_job.parts) p where p->>'id'=p_artifact_id::text) then raise exception 'export_access_denied' using errcode='42501';end if;
 if p_token_digest is null or p_token_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid_download_digest' using errcode='22023';end if;
 update public.export_jobs set grant_id=gen_random_uuid(),grant_digest=p_token_digest,grant_artifact_id=p_artifact_id::text,grant_expires_at=least(expires_at,clock_timestamp()+interval '5 minutes') where organization_id=v_job.organization_id and id=p_job_id returning * into v_job;
 perform public.m14_03_audit(v_job,'download_authorized',v_job.grant_id);v_prefix:=case p_subject_kind when 'auditor_session' then 'auditor' else 'supplier-evidence-portal' end;
 return jsonb_build_object('grantId',v_job.grant_id,'expiresAt',v_job.grant_expires_at,'downloadPath','/api/v1/'||v_prefix||'/exports/'||v_job.id||'/download/'||v_job.grant_id);
end $$;
create function public.m14_03_redeem_portal_export_download_grant(p_subject_kind text,p_session_digest text,p_job_id uuid,p_grant_id uuid,p_token_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;v_artifact jsonb;
begin
 v_job:=public.m14_03_portal_job(p_subject_kind,p_session_digest,p_job_id,true);
 if v_job.state<>'ready' or v_job.expires_at<=clock_timestamp() or v_job.grant_expires_at<=clock_timestamp() or v_job.grant_id is distinct from p_grant_id or v_job.grant_digest is null or v_job.grant_digest is distinct from p_token_digest then raise exception 'export_access_denied' using errcode='42501';end if;
 select p into v_artifact from jsonb_array_elements(v_job.parts) p where p->>'id'=v_job.grant_artifact_id;if v_artifact is null then raise exception 'export_access_denied' using errcode='42501';end if;
 perform public.m14_03_audit(v_job,'download_started',p_grant_id);
 update public.export_jobs set grant_id=null,grant_digest=null,grant_expires_at=null where organization_id=v_job.organization_id and id=p_job_id;
 return jsonb_build_object('organizationId',v_job.organization_id,'artifact',v_artifact-'startOrdinal'-'endOrdinal');
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'm14_03_%' loop
 execute format('alter function %s owner to postgres',f.signature);execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
