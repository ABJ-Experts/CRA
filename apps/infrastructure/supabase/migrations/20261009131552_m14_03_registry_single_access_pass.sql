-- Registry authorization already combines tenant-qualified existence and
-- exact immutable source identity. Run it once before the generic domain
-- existence pass, preserving fresh common principal/session/field checks.
do $single_pass$ declare v_def text;v_generic text;begin
 v_def:=pg_get_functiondef('public.m14_03_snapshot_access(public.export_jobs)'::regprocedure);
 v_generic:=$old$if exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and r.product_id is not null
 and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id=r.product_id)) then return false; end if;$old$;
 if position(v_generic in v_def)=0 or position('p.id=r.product_id and p.id::text=r.source_id' in v_def)=0 then raise exception 'registry_single_access_baseline_changed';end if;
 v_def:=replace(v_def,v_generic,'');
 v_def:=replace(v_def,'return public.m14_03_domain_snapshot_access(p_job);',v_generic||E'\n return public.m14_03_domain_snapshot_access(p_job);');
 execute v_def;
end $single_pass$;
