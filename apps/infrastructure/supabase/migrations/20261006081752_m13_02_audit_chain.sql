-- M13-02. Existing audit rows are deliberately not backfilled or rewritten.
-- Install while source writers/workers are paused. One transaction is required.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='cra_audit_chain_writer') then
  create role cra_audit_chain_writer nologin noinherit nobypassrls;
 end if;
end $$;
-- The migration administrator may assign ownership, but no application role
-- receives membership or inherits writer privileges. PostgreSQL 16+ role options.
grant cra_audit_chain_writer to postgres with inherit false, set true;
grant create on schema public to cra_audit_chain_writer;
alter table public.audit_logs
 add column chain_version integer,
 add column chain_sequence bigint,
 add column previous_hash text,
 add column content_hash text,
 add column canonical_content text,
 add constraint audit_logs_chain_complete check ((
  (chain_version is null and chain_sequence is null and previous_hash is null and content_hash is null and canonical_content is null)
  or (organization_id is not null and chain_version=1 and chain_sequence is null and previous_hash is null and content_hash is null and canonical_content is null)
  or ((organization_id is not null and chain_version=1 and chain_sequence>0
    and previous_hash ~ '^[0-9a-f]{64}$' and content_hash ~ '^[0-9a-f]{64}$'
    and canonical_content is not null) is true)) is true),
 drop constraint audit_logs_user_id_fkey,
 drop constraint audit_logs_organization_id_fkey,
 add constraint audit_logs_organization_id_fkey foreign key(organization_id)
  references public.organizations(id) on delete restrict;
create index audit_logs_pending_chain on public.audit_logs(organization_id,created_at,id) where chain_version=1 and chain_sequence is null;
create unique index audit_logs_tenant_chain_sequence on public.audit_logs(organization_id,chain_sequence) where chain_sequence is not null;

create table public.audit_chain_heads(
 organization_id uuid primary key references public.organizations(id) on delete restrict,
 activation_at timestamptz not null default clock_timestamp(),
 legacy_count bigint not null check(legacy_count>=0),
 last_sequence bigint not null default 0 check(last_sequence>=0),
 last_event_id uuid,
 last_hash text not null default repeat('0',64) check(last_hash ~ '^[0-9a-f]{64}$'),
 protected_through timestamptz,
 required_retention_days integer not null default 0 check(required_retention_days>=0),
 retention_status text not null default 'unknown' check(retention_status in ('unknown','protected','complete')),
 retention_checked_at timestamptz,
 legal_hold boolean not null default false,
 constraint audit_chain_heads_genesis check((last_sequence=0 and last_event_id is null and last_hash=repeat('0',64)) or (last_sequence>0 and last_event_id is not null))
);
alter table public.audit_chain_heads enable row level security;
insert into public.audit_chain_heads(organization_id,legacy_count)
 select o.id,count(a.id) from public.organizations o left join public.audit_logs a on a.organization_id=o.id group by o.id;
revoke all on public.audit_chain_heads from public,anon,authenticated,service_role;
grant select on public.audit_chain_heads to service_role;
grant usage on schema public,extensions to cra_audit_chain_writer;
grant select,insert,update on public.audit_chain_heads to cra_audit_chain_writer;
grant select on public.audit_logs to cra_audit_chain_writer;
grant update(chain_version,chain_sequence,previous_hash,content_hash,canonical_content) on public.audit_logs to cra_audit_chain_writer;
create policy audit_chain_writer_select on public.audit_logs for select to cra_audit_chain_writer using(true);
create policy audit_chain_writer_finalize on public.audit_logs for update to cra_audit_chain_writer using(chain_version=1 and chain_sequence is null) with check(chain_version=1 and chain_sequence is not null);
create policy audit_chain_writer_head on public.audit_chain_heads for all to cra_audit_chain_writer using(true) with check(true);
revoke update,delete,truncate,references,trigger,maintain on public.audit_logs from public,anon,authenticated,service_role;

create function public.m13_02_audit_lock_key(p_organization_id uuid)
returns bigint language sql immutable strict set search_path=pg_catalog,pg_temp as $$
 select hashtextextended('cra:audit-chain:'||p_organization_id::text,0)
$$;

-- JSONB stores arbitrary precision decimal values. Do not round via float8 or JS.
create function public.m13_02_canonical_json(p_value jsonb)
returns text language plpgsql immutable set search_path=pg_catalog,public,pg_temp as $$
declare v_kind text:=jsonb_typeof(p_value); v_result text; begin
 if p_value is null then return 'null'; end if;
 case v_kind
 when 'object' then
  select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.m13_02_canonical_json(value),',' order by convert_to(key,'UTF8')),'')||'}' into v_result from jsonb_each(p_value);
 when 'array' then
  select '['||coalesce(string_agg(public.m13_02_canonical_json(value),',' order by ordinality),'')||']' into v_result from jsonb_array_elements(p_value) with ordinality;
 when 'number' then v_result:=trim_scale((p_value#>>'{}')::numeric)::text;
 else v_result:=p_value::text;
 end case;
 return v_result;
end $$;

create function public.m13_02_canonical_content(p_row public.audit_logs,p_sequence bigint)
returns text language sql immutable set search_path=pg_catalog,public,pg_temp as $$
 select public.m13_02_canonical_json(
  jsonb_build_object('id',p_row.id,'organization_id',p_row.organization_id,
   'user_id',p_row.user_id,'actor_email',p_row.actor_email,'action',p_row.action,
   'entity_type',p_row.entity_type,'entity_id',p_row.entity_id,'changes',p_row.changes,
   'ip_address',p_row.ip_address,'user_agent',p_row.user_agent,
   'schema_version',p_row.schema_version,'event_scope',p_row.event_scope,
   'event_key',p_row.event_key,'actor_type',p_row.actor_type,'actor_id',p_row.actor_id,
   'outcome',p_row.outcome,'correlation_id',p_row.correlation_id,
   'before_redacted',p_row.before_redacted,'after_redacted',p_row.after_redacted,
   'reason',p_row.reason,'redaction_version',p_row.redaction_version,
   'chain_version',1,'chain_sequence',p_sequence::text,
   'created_at',to_char(p_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')))
$$;

create function public.m13_02_guard_audit_insert()
returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$ begin
 if new.chain_version is not null or new.chain_sequence is not null or new.previous_hash is not null or new.content_hash is not null or new.canonical_content is not null then
  raise exception using errcode='23514',message='audit chain metadata is writer-owned';
 end if;
 if not isfinite(new.created_at) then raise exception using errcode='23514',message='audit timestamp must be finite'; end if;
 if new.organization_id is not null then new.chain_version:=1; end if;
 return new;
end $$;
create trigger m13_02_guard_audit_insert before insert on public.audit_logs for each row execute function public.m13_02_guard_audit_insert();

create function public.m13_02_guard_audit_mutation()
returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$ begin
 if tg_op='UPDATE' and current_user='cra_audit_chain_writer' and pg_trigger_depth()>=2
  and old.chain_version=1 and old.chain_sequence is null and new.chain_version=1
  and new.chain_sequence is not null and new.previous_hash is not null and new.content_hash is not null and new.canonical_content is not null
  and (to_jsonb(old)-array['chain_version','chain_sequence','previous_hash','content_hash','canonical_content'])
    =(to_jsonb(new)-array['chain_version','chain_sequence','previous_hash','content_hash','canonical_content'])
 then return new; end if;
 raise exception using errcode='42501',message='audit ledger is append-only';
end $$;
create trigger m13_02_guard_audit_mutation before update or delete on public.audit_logs for each row execute function public.m13_02_guard_audit_mutation();
create trigger m13_02_guard_audit_truncate before truncate on public.audit_logs for each statement execute function public.m13_02_guard_audit_mutation();

create function public.m13_02_finalize_audit_chain()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,extensions,pg_temp as $$
declare v_org uuid; v_row public.audit_logs; v_tail public.audit_logs; v_head public.audit_chain_heads;
 v_sequence bigint; v_canonical text; v_hash text; v_held_max text;
begin
 -- The BEFORE INSERT marker distinguishes pending prospective rows from legacy
 -- rows, including inserts inside subtransactions. No pending row can commit.
 -- The first queued trigger finalizes the complete visible pending batch.
 if not exists(select 1 from public.audit_logs where id=new.id and chain_version=1 and chain_sequence is null and organization_id is not null) then return null; end if;
 select max(h.organization_id::text collate "C") into v_held_max
 from public.audit_chain_heads h join pg_locks l
 on l.locktype='advisory' and l.pid=pg_backend_pid() and l.granted and l.objsubid=1
 and l.classid::bigint=((public.m13_02_audit_lock_key(h.organization_id)>>32)&4294967295)
 and l.objid::bigint=(public.m13_02_audit_lock_key(h.organization_id)&4294967295);
 for v_org in select distinct organization_id from public.audit_logs where chain_version=1 and chain_sequence is null and organization_id is not null order by organization_id loop
  -- SET CONSTRAINTS IMMEDIATE can finalize an earlier batch. Refuse descending
  -- lock acquisition for subsequent batches instead of introducing a deadlock.
  if v_held_max is not null and v_org::text collate "C"<v_held_max then
   raise exception using errcode='40001',message='audit tenant lock order changed; retry transaction';
  end if;
  perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(v_org));
 end loop;
 for v_org in select distinct organization_id from public.audit_logs where chain_version=1 and chain_sequence is null and organization_id is not null order by organization_id loop
  insert into public.audit_chain_heads(organization_id,legacy_count) values(v_org,0) on conflict(organization_id) do nothing;
  select * into strict v_head from public.audit_chain_heads where organization_id=v_org for update;
  if v_head.last_sequence>0 then
   select * into v_tail from public.audit_logs where organization_id=v_org and id=v_head.last_event_id;
   if not found or v_tail.chain_sequence is distinct from v_head.last_sequence or v_tail.content_hash is distinct from v_head.last_hash
    or v_tail.canonical_content is distinct from public.m13_02_canonical_content(v_tail,v_tail.chain_sequence)
    or v_tail.content_hash is distinct from encode(extensions.digest(decode(v_tail.previous_hash,'hex')||convert_to(v_tail.canonical_content,'UTF8'),'sha256'),'hex')
   then raise exception using errcode='23514',message='audit chain head integrity failure'; end if;
  end if;
  if exists(select 1 from public.audit_logs where organization_id=v_org and chain_sequence>v_head.last_sequence) then
   raise exception using errcode='23514',message='audit chain head is behind retained ledger';
  end if;
  for v_row in select * from public.audit_logs where organization_id=v_org and chain_version=1 and chain_sequence is null order by created_at,id loop
   v_sequence:=v_head.last_sequence+1;
   v_canonical:=public.m13_02_canonical_content(v_row,v_sequence);
   v_hash:=encode(extensions.digest(decode(v_head.last_hash,'hex')||convert_to(v_canonical,'UTF8'),'sha256'),'hex');
   update public.audit_logs set chain_version=1,chain_sequence=v_sequence,previous_hash=v_head.last_hash,content_hash=v_hash,canonical_content=v_canonical where id=v_row.id;
   if not found then raise exception using errcode='23514',message='audit finalization failed'; end if;
   v_head.last_sequence:=v_sequence; v_head.last_event_id:=v_row.id; v_head.last_hash:=v_hash;
  end loop;
  update public.audit_chain_heads set last_sequence=v_head.last_sequence,last_event_id=v_head.last_event_id,last_hash=v_head.last_hash where organization_id=v_org;
 end loop;
 if exists(select 1 from public.audit_logs where chain_version=1 and chain_sequence is null) then
  raise exception using errcode='23514',message='audit pending rows were not finalized';
 end if;
 return null;
end $$;
alter function public.m13_02_finalize_audit_chain() owner to cra_audit_chain_writer;
create constraint trigger m13_02_finalize_audit_chain after insert on public.audit_logs deferrable initially deferred for each row execute function public.m13_02_finalize_audit_chain();

create function public.m13_02_audit_chain_snapshot(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_head public.audit_chain_heads; v_tail public.audit_logs; begin
 if p_organization_id is null then raise exception using errcode='22023',message='organization is required'; end if;
 select * into v_head from public.audit_chain_heads where organization_id=p_organization_id;
 if not found then raise exception using errcode='22023',message='audit chain is not activated'; end if;
 select * into v_tail from public.audit_logs where organization_id=p_organization_id and chain_sequence is not null order by chain_sequence desc limit 1;
 if (v_head.last_sequence=0 and found) or (v_head.last_sequence>0 and (not found or v_tail.chain_sequence is distinct from v_head.last_sequence or v_tail.id is distinct from v_head.last_event_id or v_tail.content_hash is distinct from v_head.last_hash)) then
  raise exception using errcode='23514',message='audit chain head integrity failure';
 end if;
 return jsonb_build_object('organization_id',v_head.organization_id,'chain_version',1,'activation_at',v_head.activation_at,'legacy_count',v_head.legacy_count::text,'last_sequence',v_head.last_sequence::text,'last_event_id',v_head.last_event_id,'last_hash',v_head.last_hash,
  'protected_through',v_head.protected_through,'required_retention_days',v_head.required_retention_days,
  'retention_status',v_head.retention_status,'retention_checked_at',v_head.retention_checked_at,'legal_hold',v_head.legal_hold);
end $$;
create function public.m13_02_audit_chain_page(p_organization_id uuid,p_after_sequence text,p_upper_sequence text,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_row public.audit_logs; v_item jsonb; v_result jsonb:='[]'::jsonb; v_bytes bigint:=2; v_size bigint;
begin
 if p_organization_id is null or p_after_sequence is null or p_upper_sequence is null or p_after_sequence!~'^(0|[1-9][0-9]{0,18})$' or p_upper_sequence!~'^(0|[1-9][0-9]{0,18})$' or p_limit is null or p_limit not between 1 and 1000 or p_after_sequence::numeric>9223372036854775807 or p_upper_sequence::numeric>9223372036854775807 or p_after_sequence::numeric>p_upper_sequence::numeric then
  raise exception using errcode='22023',message='invalid audit verification range';
 end if;
 for v_row in select * from public.audit_logs where organization_id=p_organization_id and chain_sequence>p_after_sequence::bigint and chain_sequence<=p_upper_sequence::bigint order by chain_sequence limit p_limit loop
  v_item:=jsonb_build_object('id',v_row.id,'chain_version',v_row.chain_version,'chain_sequence',v_row.chain_sequence::text,'previous_hash',v_row.previous_hash,'content_hash',v_row.content_hash,'canonical_content',v_row.canonical_content,'recomputed_canonical_content',public.m13_02_canonical_content(v_row,v_row.chain_sequence));
  v_size:=octet_length(v_item::text)+1;
  if v_bytes+v_size>16777216 then
   if v_bytes=2 then raise exception using errcode='54000',message='audit verification row exceeds bounded response'; end if;
   exit;
  end if;
  v_result:=v_result||jsonb_build_array(v_item); v_bytes:=v_bytes+v_size;
 end loop;
 return v_result;
end $$;
revoke all on function public.m13_02_audit_lock_key(uuid),public.m13_02_canonical_json(jsonb),public.m13_02_canonical_content(public.audit_logs,bigint),public.m13_02_guard_audit_insert(),public.m13_02_guard_audit_mutation(),public.m13_02_audit_chain_snapshot(uuid),public.m13_02_audit_chain_page(uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.m13_02_audit_lock_key(uuid),public.m13_02_canonical_json(jsonb),public.m13_02_canonical_content(public.audit_logs,bigint),public.m13_02_guard_audit_mutation() to cra_audit_chain_writer;
grant execute on function public.m13_02_audit_chain_snapshot(uuid),public.m13_02_audit_chain_page(uuid,text,text,integer) to service_role;

set local role cra_audit_chain_writer;
revoke all on function public.m13_02_finalize_audit_chain() from public,anon,authenticated,service_role;
reset role;
revoke create on schema public from cra_audit_chain_writer;
