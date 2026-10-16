-- Additive repair for source-owned admissions after a queue lease was acquired.
-- Denials release only eligible claimed work; source identity/fences stay intact.
do $import_pause$
declare r regprocedure:='public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid)'::regprocedure;d text;b text;gate text:='if exists(select 1 from public.organizations where id=p_organization_id) and (true) then perform public.m15_01_assert_customer_write(p_organization_id,''products''); end if;';anchor text:='if not public.product_import_commit_references_valid(p_organization_id,p_import_id) then';
begin
 d:=pg_get_functiondef(r);
 if strpos(d,gate)=0 or strpos(d,anchor)=0 then raise exception 'M15 outer import admission source drift';end if;
 b:=replace(d,gate,'');
 b:=replace(b,anchor,$replacement$begin
    perform public.m15_01_assert_customer_write(p_organization_id,'products');
  exception when insufficient_privilege then
    if sqlerrm<>'licensing_customer_write_denied' or v_job.status<>'committing' or v_job.lease_owner is null then raise;end if;
    update public.product_import_jobs set status='retrying',lease_owner=null,lease_expires_at=null,error_code=null
    where organization_id=p_organization_id and id=p_import_id;
    return query select 'retrying'::text,public.product_import_job_json(p_organization_id,p_import_id);return;
  end;
  $replacement$||anchor);
 execute b;
end $import_pause$;

-- Product creation capacity is tested before both source selections and LIMIT.
-- Updates, dry runs and unrelated tenant work do not consume planned creates.
create function public.m15_01_sync_capacity_allowed(p_organization_id uuid,p_sync_run_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.m15_01_customer_write_allowed(p_organization_id,'products') and coalesce((select
  (s.verified_claims->'limits'->>'products') is null or
  (select count(*) from public.products p where p.organization_id=p_organization_id and p.archived_at is null)
  +(select count(*) from public.sync_run_plan_items i where i.organization_id=p_organization_id and i.sync_run_id=p_sync_run_id
    and i.entity_type='product' and i.proposed_action='create' and i.applied_at is null)
  <=(s.verified_claims->'limits'->>'products')::bigint
  from public.organization_license_states s where s.organization_id=p_organization_id),false)
$$;
revoke all on function public.m15_01_sync_capacity_allowed(uuid,uuid) from public,anon,authenticated,service_role;

do $sync_claim$
declare r regprocedure;d text;anchor text;
begin
 r:='public.m1102_claim_sync_run(uuid,text,integer)'::regprocedure;d:=pg_get_functiondef(r);
 anchor:='where r.organization_id=p_organization_id';
 if strpos(d,anchor)=0 then raise exception 'M15 connector candidate source drift';end if;
 d:=replace(d,anchor,anchor||' and (r.work_kind<>''commit'' or public.m15_01_sync_capacity_allowed(p_organization_id,r.id))');
 anchor:='where organization_id=p_organization_id and connector_id=v_connector';
 if strpos(d,anchor)=0 then raise exception 'M15 connector locked candidate source drift';end if;
 d:=replace(d,anchor,anchor||' and (work_kind<>''commit'' or public.m15_01_sync_capacity_allowed(p_organization_id,id))');
 execute d;
 r:='public.m1102_list_due_sync_run_organizations(integer)'::regprocedure;d:=pg_get_functiondef(r);
 anchor:='from public.sync_runs r where';
 if strpos(d,anchor)=0 then raise exception 'M15 connector tenant candidate source drift';end if;
 d:=replace(d,anchor,anchor||' public.m15_01_customer_write_allowed(r.organization_id,''connectors'') and (r.work_kind<>''commit'' or public.m15_01_sync_capacity_allowed(r.organization_id,r.id)) and (');
 anchor:='group by r.organization_id';
 if strpos(d,anchor)=0 then raise exception 'M15 connector tenant ordering source drift';end if;
 execute replace(d,anchor,') '||anchor);
end $sync_claim$;

-- Preserve exact licensing SQLSTATE/reason across the internal row subtransaction.
-- Other authorization and source failures continue through the original handler.
do $sync_pause$
declare r regprocedure;d text;anchor text;
begin
 r:='public.m1102_commit_plan_internal(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure;d:=pg_get_functiondef(r);
 anchor:='exception when others then'||chr(10)||' raise exception using errcode=SQLSTATE,message=''sync_commit_failed''';
 if strpos(d,anchor)=0 then raise exception 'M15 connector inner exception source drift';end if;
 execute replace(d,anchor,'exception when others then'||chr(10)||' if sqlstate=''42501'' and sqlerrm in (''licensing_product_limit'',''licensing_customer_write_denied'') then raise;end if;'||chr(10)||' raise exception using errcode=SQLSTATE,message=''sync_commit_failed''');
 r:='public.m1102_commit_sync_run_atomic(uuid,uuid,uuid,text,integer,text,uuid,uuid)'::regprocedure;d:=pg_get_functiondef(r);
 anchor:='select * into v_result from public.m1102_commit_plan_internal';
 if strpos(d,anchor)=0 then raise exception 'M15 connector commit entry source drift';end if;
 d:=replace(d,anchor,'perform public.m15_01_assert_customer_write(p_organization_id,''connectors'');'||chr(10)||' '||anchor);
 anchor:='exception when others then'||chr(10)||' get stacked diagnostics';
 if strpos(d,anchor)=0 then raise exception 'M15 connector outer exception source drift';end if;
 d:=replace(d,anchor,$replacement$exception when others then
 if sqlstate='42501' and sqlerrm in ('licensing_product_limit','licensing_customer_write_denied') then
   update public.sync_runs set status='retrying',lease_owner=null,lease_expires_at=null,error_code=null
   where organization_id=p_organization_id and id=p_sync_run_id;
   update public.sync_run_attempts set finished_at=clock_timestamp(),outcome='interrupted',error_category='interrupted',error_code=sqlerrm
   where organization_id=p_organization_id and sync_run_id=p_sync_run_id and lease_generation=p_generation and finished_at is null;
   select * into v_run from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id;
   return query select 'retrying'::text,public.m2_v2_sync_run_json(v_run);return;
 end if;
 get stacked diagnostics$replacement$);
 execute d;
end $sync_pause$;
notify pgrst,'reload schema';
