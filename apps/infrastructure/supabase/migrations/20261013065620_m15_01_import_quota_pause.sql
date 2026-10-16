-- Planned imports wait for sufficient capacity before consuming a source lease.
-- Existing queue states and row plans remain the durable source of truth.
create function public.m15_01_import_capacity_allowed(p_organization_id uuid,p_import_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce((select
   (s.verified_claims->'limits'->>'products') is null or
   (select count(*) from public.products p where p.organization_id=p_organization_id and p.archived_at is null)
   + (select count(*) from public.product_import_rows r where r.organization_id=p_organization_id
      and r.import_id=p_import_id and r.row_type='product' and r.proposed_action='create' and r.result='planned')
   <= (s.verified_claims->'limits'->>'products')::bigint
 from public.organization_license_states s where s.organization_id=p_organization_id),false)
$$;
revoke all on function public.m15_01_import_capacity_allowed(uuid,uuid) from public,anon,authenticated,service_role;

-- Global claims filter before LIMIT, so a blocked import cannot starve a smaller
-- import or dry run. Exact direct claims retain their original not_found result.
do $claim_patch$
declare r regprocedure;d text;old_clause text;new_clause text;
begin
 r:='public.claim_product_import_job(uuid,text,integer)'::regprocedure;
 d:=pg_get_functiondef(r);
 old_clause:='and jobs.next_attempt_at<=now() and jobs.expires_at>now()';
 new_clause:=old_clause||' and (jobs.work_kind<>''commit'' or public.m15_01_import_capacity_allowed(p_organization_id,jobs.id))';
 if strpos(d,old_clause)=0 then raise exception 'M15 import quota global claim source drift';end if;
 execute replace(d,old_clause,new_clause);
 r:='public.claim_product_import_job_by_id(uuid,uuid,text,integer)'::regprocedure;
 d:=pg_get_functiondef(r);
 old_clause:='update public.product_import_jobs set';
 new_clause:='if v_job.work_kind=''commit'' and not public.m15_01_import_capacity_allowed(p_organization_id,p_import_id) then return query select ''empty''::text,null::jsonb,null::jsonb; return; end if; '||old_clause;
 if strpos(d,old_clause)=0 then raise exception 'M15 import quota direct claim source drift';end if;
 execute replace(d,old_clause,new_clause);
end $claim_patch$;

-- The row writer already uses a subtransaction to roll back the entire import.
-- A quota change between claim and commit releases only its lease, without a
-- retry count, failure audit, or loss of plans. Fresh source claims decide resume.
do $commit_patch$
declare r regprocedure:='public.commit_product_import_rows_atomic(uuid,uuid,uuid,text,uuid)'::regprocedure;d text;old_clause text;new_clause text;
begin
 d:=pg_get_functiondef(r);
 old_clause:='exception when others then';
 new_clause:=$replacement$exception when others then
    if sqlstate='42501' and sqlerrm in ('licensing_product_limit','licensing_customer_write_denied') then
      update public.product_import_jobs set status='retrying',lease_owner=null,lease_expires_at=null,error_code=null
      where organization_id=p_organization_id and id=p_import_id;
      return query select 'retrying'::text,public.product_import_job_json(p_organization_id,p_import_id);
      return;
    end if;
$replacement$;
 if strpos(d,old_clause)=0 then raise exception 'M15 import quota commit source drift';end if;
 execute replace(d,old_clause,new_clause);
end $commit_patch$;
notify pgrst,'reload schema';
