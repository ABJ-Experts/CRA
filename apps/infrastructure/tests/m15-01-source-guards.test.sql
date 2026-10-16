-- Rollback-only checks; root runs against the confirmed local CRA deployment.
begin;
set local statement_timeout='30s';
create function pg_temp.m15_check(label text, ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(ok,false) then raise exception 'M15 source guard failed: %',label;end if;
end $$;
select pg_temp.m15_check('product edits transact licensing',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_product_atomic' and p.prosrc like '%m15_01_assert_customer_write(p_organization_id,%''products''%'));
select pg_temp.m15_check('release edits transact licensing',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='update_product_release_atomic' and p.prosrc like '%m15_01_assert_customer_write(p_organization_id,%''products''%'));
select pg_temp.m15_check('framework commands transact licensing',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='m10_control_command' and p.prosrc like '%m15_01_assert_customer_write%'));
select pg_temp.m15_check('audit append ungated',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='m13_01_append_audit_event' and p.prosrc like '%m15_01_assert_customer_write%'));
select pg_temp.m15_check('manual VEX export ungated',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_vulnerability_vex_export_snapshot_atomic' and p.prosrc like '%m15_01_assert_customer_write%'));
-- Source authority must reject a nongrowth direct RPC before any customer side effect.
do $$ declare o uuid;u uuid;begin
 select organization_id,user_id into strict o,u from public.organization_members where role='owner' limit 1;
 delete from public.organization_license_states where organization_id=o;
 begin
 perform public.update_product_atomic(o,gen_random_uuid(),u,0,'should never persist',null,null,null,false,null);
 raise exception 'licence guard bypass';
 exception when insufficient_privilege then
 if sqlerrm<>'licensing_customer_write_denied' then raise;end if;
 end;
 begin
 perform public.m10_control_command(o,u,'create_control','{}'::jsonb,0,gen_random_uuid());
 raise exception 'licence guard bypass';
 exception when insufficient_privilege then
 if sqlerrm<>'licensing_customer_write_denied' then raise;end if;
 end;
end $$;
rollback;
