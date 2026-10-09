-- M10-03 follow-up: bounded aggregate, explicit retry state, and serialized
-- concurrent applicability writes without changing the published RPC shape.
create function public.m10_coverage_summary(
  p_organization_id uuid,p_product_id uuid,p_pack_key text,p_version_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_summary jsonb;
begin
  if not exists(select 1 from public.framework_coverage_scopes s
    where s.organization_id=p_organization_id and s.product_id=p_product_id
      and s.pack_key=p_pack_key and s.version_key=p_version_key
      and s.status='current' and s.source_revision=s.computed_revision
      and (s.next_boundary_on is null
        or s.next_boundary_on>(clock_timestamp() at time zone 'UTC')::date))
  then return null; end if;
  select jsonb_build_object(
    'totalRequirements',count(*),
    'applicableRequirements',count(*) filter(where r.status not in ('structural','excluded')),
    'excludedRequirements',count(*) filter(where r.status='excluded'),
    'evidenceBackedRequirements',count(*) filter(where r.status='evidence_backed'),
    'gapRequirements',count(*) filter(where r.status not in ('structural','excluded','evidence_backed')),
    'byStatus',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb)
      from (select status,count(*) n from public.framework_coverage_rows x
        where x.organization_id=p_organization_id and x.product_id=p_product_id
          and x.pack_key=p_pack_key and x.version_key=p_version_key
        group by status) counts)) into v_summary
  from public.framework_coverage_rows r
  where r.organization_id=p_organization_id and r.product_id=p_product_id
    and r.pack_key=p_pack_key and r.version_key=p_version_key;
  return v_summary;
end $$;

create function public.m10_fail_coverage_scope(
  p_worker_id uuid,p_organization_id uuid,p_product_id uuid,
  p_pack_key text,p_version_key text,p_error text
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  update public.framework_coverage_scopes s
  set status='error',lease_owner=null,lease_expires_at=null,
    next_attempt_at=clock_timestamp()+least(interval '1 hour',
      interval '10 seconds'*power(2,least(s.attempt_count,8))),
    last_error=left(coalesce(nullif(btrim(p_error),''),'coverage_recalculation_failed'),1000),
    updated_at=clock_timestamp()
  where s.organization_id=p_organization_id and s.product_id=p_product_id
    and s.pack_key=p_pack_key and s.version_key=p_version_key
    and s.status='leased' and s.lease_owner=p_worker_id;
  get diagnostics v_count=row_count;
  return case when v_count=1 then 'retry' else 'lease_lost' end;
end $$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid)'::regprocedure)
  into v_definition;
  if position('select * into v_current from public.framework_requirement_applicability a' in v_definition)=0 then
    raise exception 'M10 applicability lock anchor missing';
  end if;
  execute replace(v_definition,
    'select * into v_current from public.framework_requirement_applicability a',
    'perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||'':''||p_product_id::text||'':''||p_pack_key||'':''||p_version_key||'':''||p_requirement_key,1));'
    || chr(10) || '  select * into v_current from public.framework_requirement_applicability a');
end $$;

revoke all on function public.m10_coverage_summary(uuid,uuid,text,text),
  public.m10_fail_coverage_scope(uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.m10_coverage_summary(uuid,uuid,text,text),
  public.m10_fail_coverage_scope(uuid,uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
