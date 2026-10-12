-- Preserve textual source identity while giving the source authorization join
-- its typed UUID index key. One current membership check covers the set, and
-- the existing common job/session/field policy still runs for every access.
do $registry$ declare v_def text;v_old text;begin
 v_def:=pg_get_functiondef('public.m14_03_snapshot_access(public.export_jobs)'::regprocedure);
 v_old:=$old$if p_job.source in ('products','products.registry') then
 return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id
 and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id::text=r.source_id and public.m2_active_member(p_job.organization_id,p_job.requester_id)));
 end if;$old$;
 if position(v_old in v_def)=0 then raise exception 'registry_authorization_baseline_changed';end if;
 v_def:=replace(v_def,v_old,$new$if p_job.source in ('products','products.registry') then
 if not public.m2_active_member(p_job.organization_id,p_job.requester_id) then return false;end if;
 return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id
 and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id=r.product_id and p.id::text=r.source_id));
 end if;$new$);
 execute v_def;
end $registry$;
