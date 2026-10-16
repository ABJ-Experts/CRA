-- Preserve the legacy facade's exact configured path; the new private immutable
-- read projection keeps its existing pg_catalog-first path and explicit grants.
alter function public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)
 set search_path=public,pg_temp;

-- Native assessment wire evidence is evidenceLinks, not evidenceReferences.
-- Restore that same list projection without changing scoring or approval rules.
do $evidence$ declare v_def text;begin
 v_def:=pg_get_functiondef('public.m14_03_nested_domain_source_rows(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 if position('array[''assessment'',''evidenceReferences'']' in v_def)=0 then raise exception 'assessment_evidence_projection_baseline_changed';end if;
 v_def:=replace(v_def,'array[''assessment'',''evidenceReferences'']','array[''assessment'',''evidenceLinks'']');execute v_def;
end $evidence$;

-- Approved fields follow the native assessment evidence link wire contract.
alter function public.m14_03_source_policy(text) rename to m14_03_pre_evidence_link_policy;
create function public.m14_03_source_policy(p_source text) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select case when p_source='findings.detail.assessment_evidence' then jsonb_set(public.m14_03_pre_evidence_link_policy(p_source),'{columns}','["id","kind","title","url","evidenceId"]'::jsonb)
 else public.m14_03_pre_evidence_link_policy(p_source) end
$$;
revoke all on function public.m14_03_source_policy(text) from public,anon,authenticated;
grant execute on function public.m14_03_source_policy(text) to service_role;

-- Every identity kind, metadata read, worker and delivery uses this common
-- fresh policy boundary. Removed fields revoke the whole frozen artifact before
-- counts or values can be disclosed; old artifacts never expand current grants.
alter function public.m14_03_job_access(public.export_jobs) rename to m14_03_pre_column_job_access;
create function public.m14_03_job_access(p_job public.export_jobs) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_policy jsonb;v_subject text;
begin
 v_policy:=public.m14_03_source_policy(p_job.source);
 v_subject:=case p_job.subject_kind when 'member' then 'member' when 'supplier' then 'supplier_session' when 'auditor' then 'auditor_session' end;
 if v_policy is null or v_subject is null or v_policy->>'subjectKind' is distinct from v_subject
 or exists(select 1 from jsonb_array_elements_text(p_job.columns) c where not (v_policy->'columns' ? c.value)) then return false;end if;
 return public.m14_03_pre_column_job_access(p_job);
end $$;
revoke all on function public.m14_03_job_access(public.export_jobs) from public,anon,authenticated;
grant execute on function public.m14_03_job_access(public.export_jobs) to service_role;

-- Availability expiry changes the public state even when a worker is idle.
-- It never authorizes retention deletion or weakens fresh principal checks.
do $expiry$ declare v_def text;begin
 v_def:=pg_get_functiondef('public.m14_03_job_json(public.export_jobs)'::regprocedure);
 if position('''retryable'',p_job.failure_code in (' in v_def)=0 then raise exception 'export_job_json_baseline_changed';end if;
 v_def:=replace(v_def,'''retryable'',p_job.failure_code in (','''retryable'',p_job.expires_at>clock_timestamp() and p_job.failure_code in (');
 execute v_def;
end $expiry$;

-- Cover requester FK lookups without changing tenant-first list indexes.
create index export_jobs_requester_id_idx on public.export_jobs(requester_id)
 where requester_id is not null;

-- JavaScript transport cannot represent arbitrary PostgreSQL numeric values.
-- Preserve approved scalar decimals and large integers as exact text before
-- hashing/storage/wire serialization. Safe integral operational counts remain
-- typed numbers; nested canonical readiness contracts retain their native shape.
create function public.m14_03_export_scalar(p_value jsonb) returns jsonb
 language sql immutable set search_path=pg_catalog,public as $$
 select case when jsonb_typeof(p_value)='number' and
 ((p_value::text)::numeric<>trunc((p_value::text)::numeric)
 or abs((p_value::text)::numeric)>9007199254740991)
 then to_jsonb(p_value::text) else p_value end
$$;
revoke all on function public.m14_03_export_scalar(jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_export_scalar(jsonb) to service_role;
do $precision$ declare v_def text;begin
 v_def:=pg_get_functiondef('public.m14_03_capture_export(uuid,uuid,text,integer)'::regprocedure);
 if position('jsonb_object_agg(k.value,s.row_values->k.value)' in v_def)=0 then raise exception 'export_capture_projection_baseline_changed';end if;
 v_def:=replace(v_def,'jsonb_object_agg(k.value,s.row_values->k.value)','jsonb_object_agg(k.value,public.m14_03_export_scalar(s.row_values->k.value))');
 execute v_def;
end $precision$;
