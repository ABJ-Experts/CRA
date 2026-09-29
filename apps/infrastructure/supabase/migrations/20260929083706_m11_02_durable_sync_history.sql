-- Additive M11-02. Completed legacy history remains untouched. New runs capture
-- their basis; legacy active plans require review rather than guessed snapshots.
alter table public.connectors
 add column field_map jsonb not null default '[]'::jsonb check(jsonb_typeof(field_map)='array' and jsonb_array_length(field_map)<=32 and octet_length(field_map::text)<=20000),
 add column field_mapping_revision integer not null default 0 check(field_mapping_revision>=0),
 add column mapping_schema_digest text;
alter table public.sync_runs
 add column started_at timestamptz,
 add column finished_at timestamptz,
 add column version integer not null default 1 check(version>0),
 add column mapping_snapshot jsonb check(mapping_snapshot is null or(jsonb_typeof(mapping_snapshot)='array' and jsonb_array_length(mapping_snapshot)<=32 and octet_length(mapping_snapshot::text)<=20000)),
 add column field_mapping_revision integer,
 add column schema_snapshot jsonb check(schema_snapshot is null or(jsonb_typeof(schema_snapshot)='object' and octet_length(schema_snapshot::text)<=64000)),
 add column authority_snapshot jsonb check(authority_snapshot is null or(jsonb_typeof(authority_snapshot)='array' and octet_length(authority_snapshot::text)<=64000)),
 add column cursor_baseline text,
 add column replay_parent_run_id uuid,
 add column replay_root_run_id uuid,
 add column replay_source_mode text check(replay_source_mode in ('retained','refetch')),
 add column lease_generation integer not null default 0 check(lease_generation>=0),
 add column succeeded_count integer not null default 0 check(succeeded_count>=0),
 add column skipped_count integer not null default 0 check(skipped_count>=0),
 add column failed_count integer not null default 0 check(failed_count>=0),
 add column pending_count integer not null default 0 check(pending_count>=0),
 add constraint sync_runs_replay_root_fkey foreign key(organization_id,replay_root_run_id) references public.sync_runs(organization_id,id) on delete no action deferrable initially deferred,
 add constraint sync_runs_replay_parent_fkey foreign key(organization_id,replay_parent_run_id) references public.sync_runs(organization_id,id) on delete no action deferrable initially deferred;
alter table public.sync_run_plan_items
 add column source_snapshot jsonb check(source_snapshot is null or (jsonb_typeof(source_snapshot)='object' and octet_length(source_snapshot::text)<=32000 and not(source_snapshot ? 'raw'))),
 add column record_outcome text not null default 'pending' check(record_outcome in ('pending','succeeded','skipped','failed','withheld')),
 add column error_category text check(error_category in ('timeout','rate_limit','provider_unavailable','transient_database','authentication','invalid_data','unsupported','authorization','stale_preview','interrupted','unknown')),
 add column error_code text check(error_code ~ '^[a-z][a-z0-9_]{0,99}$'),
 add column dead_lettered_at timestamptz,
 add column dead_letter_resolved_at timestamptz;
create table public.sync_run_attempts(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 sync_run_id uuid not null,
 lease_generation integer not null check(lease_generation>0),
 worker_id text not null check(char_length(worker_id) between 1 and 100),
 phase text not null check(phase in ('dry_run','commit')),
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 outcome text check(outcome in ('succeeded','retrying','failed','interrupted','review_required')),
 error_category text check(error_category in ('timeout','rate_limit','provider_unavailable','transient_database','authentication','invalid_data','unsupported','authorization','stale_preview','interrupted','unknown')),
 error_code text check(error_code ~ '^[a-z][a-z0-9_]{0,99}$'),
 next_attempt_at timestamptz,
 affected_record_ids uuid[] not null default '{}' check(cardinality(affected_record_ids)<=200),
 foreign key(organization_id,sync_run_id) references public.sync_runs(organization_id,id) on delete cascade,
 unique(organization_id,sync_run_id,lease_generation),
 check((finished_at is null)=(outcome is null))
);
create index sync_runs_replay_root_idx on public.sync_runs(organization_id,replay_root_run_id) where replay_root_run_id is not null;
create index sync_runs_replay_parent_idx on public.sync_runs(organization_id,replay_parent_run_id) where replay_parent_run_id is not null;
create index sync_runs_expired_lease_idx on public.sync_runs(organization_id,lease_expires_at,id) where status='running';
create index sync_run_plan_items_dead_letters_idx on public.sync_run_plan_items(organization_id,dead_lettered_at desc,id) where dead_lettered_at is not null;
alter table public.sync_run_attempts enable row level security;
revoke all on public.sync_run_attempts from public,anon,authenticated,service_role;
grant select on public.sync_run_attempts to service_role;

-- A conflict is a field-level issue, not an additional record.
alter table public.sync_runs drop constraint sync_run_count_bounds_check;
alter table public.sync_runs add constraint sync_run_count_bounds_check check(create_count+update_count+unchanged_count+skip_count<=row_count);
create function public.m1102_record_counts_check() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.sync_runs where organization_id=new.organization_id and id=new.id and mapping_snapshot is not null
 and succeeded_count+skipped_count+failed_count+pending_count<>row_count) then
 raise exception using errcode='23514',message='record_counts_do_not_reconcile'; end if;
 return null;
end $$;
create constraint trigger m1102_record_counts_check after insert or update on public.sync_runs deferrable initially deferred for each row execute function public.m1102_record_counts_check();

create function public.m1102_attempt_immutable() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.finished_at is not null or new.finished_at is null or
 (to_jsonb(new)-array['finished_at','outcome','error_category','error_code','next_attempt_at','affected_record_ids'])
 is distinct from (to_jsonb(old)-array['finished_at','outcome','error_category','error_code','next_attempt_at','affected_record_ids']) then
 raise exception using errcode='23514',message='attempt_history_is_immutable'; end if;
 return new;
end $$;
create trigger m1102_attempt_immutable before update on public.sync_run_attempts for each row execute function public.m1102_attempt_immutable();

create function public.m1102_authority_snapshot(p_org uuid,p_connector uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'entityType',entity_type,'fieldName',field_name,'policy',policy_value,'protected',protected,'version',policy_version) order by entity_type,field_name,id),'[]'::jsonb)
 from public.field_authority_policies where organization_id=p_org and connector_id=p_connector and superseded_at is null
$$;
create function public.m1102_capture_run_basis() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 select field_map,field_mapping_revision into new.mapping_snapshot,new.field_mapping_revision from public.connectors
 where organization_id=new.organization_id and id=new.connector_id for share;
 select cursor into new.cursor_baseline from public.sync_connector_cursors where organization_id=new.organization_id and connector_id=new.connector_id for share;
 new.replay_root_run_id:=case when new.replay_parent_run_id is null then new.id else (select coalesce(replay_root_run_id,id) from public.sync_runs where organization_id=new.organization_id and id=new.replay_parent_run_id) end;
 new.authority_snapshot:=public.m1102_authority_snapshot(new.organization_id,new.connector_id);
 return new;
end $$;
create trigger m1102_capture_run_basis before insert on public.sync_runs for each row execute function public.m1102_capture_run_basis();
create function public.m1102_run_version() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 new.version:=old.version+1;
 if new.status in ('completed','failed','canceled') and old.status not in ('completed','failed','canceled') then new.finished_at:=clock_timestamp(); end if;
 if new.status='canceled' and old.status<>'canceled' then
 update public.sync_run_attempts set finished_at=clock_timestamp(),outcome='interrupted',error_category='interrupted',error_code='canceled'
 where organization_id=new.organization_id and sync_run_id=new.id and finished_at is null;
 end if;
 return new;
end $$;
create trigger m1102_run_version before update on public.sync_runs for each row execute function public.m1102_run_version();

create function public.m1102_list_due_sync_run_organizations(p_limit integer)
returns table(organization_id uuid,oldest_due_at timestamptz) language sql security definer set search_path=public,pg_temp as $$
 select r.organization_id,min(case when r.status='running' then r.lease_expires_at else r.next_attempt_at end)
 from public.sync_runs r where (r.status in ('queued','retrying') and r.next_attempt_at<=clock_timestamp() and exists(select 1 from public.sync_connector_cursors c where c.organization_id=r.organization_id and c.connector_id=r.connector_id and c.circuit_state<>'open'))
 or (r.status='running' and r.lease_expires_at<=clock_timestamp())
 group by r.organization_id order by 2,r.organization_id limit greatest(1,least(500,coalesce(p_limit,50)))
$$;

create function public.m1102_claim_sync_run(p_organization_id uuid,p_worker_id text,p_lease_seconds integer)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.sync_runs%rowtype; v_connector uuid; v_sources jsonb;
begin
 if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 100 or p_lease_seconds not between 10 and 300 then
 return query select 'invalid_request'::text,null::jsonb; return; end if;
 -- Connector first matches configuration commands; SKIP LOCKED keeps tenant work bounded.
 select r.connector_id into v_connector from public.sync_runs r where r.organization_id=p_organization_id
 and ((r.status in ('queued','retrying') and r.next_attempt_at<=clock_timestamp() and exists(select 1 from public.sync_connector_cursors c where c.organization_id=r.organization_id and c.connector_id=r.connector_id and c.circuit_state<>'open')) or (r.status='running' and r.lease_expires_at<=clock_timestamp()))
 order by r.next_attempt_at,r.created_at,r.id limit 1;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 perform 1 from public.connectors where organization_id=p_organization_id and id=v_connector for update skip locked;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_run from public.sync_runs where organization_id=p_organization_id and connector_id=v_connector
 and ((status in ('queued','retrying') and next_attempt_at<=clock_timestamp() and exists(select 1 from public.sync_connector_cursors c where c.organization_id=p_organization_id and c.connector_id=v_connector and c.circuit_state<>'open')) or (status='running' and lease_expires_at<=clock_timestamp()))
 order by next_attempt_at,created_at,id limit 1 for update skip locked;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_run.status='running' then
 update public.sync_run_attempts set finished_at=clock_timestamp(),outcome='interrupted',error_category='interrupted',error_code='lease_expired'
 where organization_id=p_organization_id and sync_run_id=v_run.id and finished_at is null;
 end if;
 if v_run.expires_at<=clock_timestamp() or not public.m11_assert_sync_run_fence(p_organization_id,v_run.id,null) then
 update public.sync_runs set status='canceled',canceled_at=clock_timestamp(),cancellation_reason='Connection, authorization or deadline changed.',
 error_code='authorization_changed',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=v_run.id;
 return query select 'invalid_state'::text,null::jsonb; return; end if;
 if exists(select 1 from public.sync_connector_cursors where organization_id=p_organization_id and connector_id=v_run.connector_id and circuit_state='open') then
 update public.sync_runs set status='retrying',error_code='provider_unavailable',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=v_run.id;
 return query select 'invalid_state'::text,null::jsonb; return; end if;
 if v_run.mapping_snapshot is null then
 update public.sync_runs set status='failed',error_code='legacy_plan_requires_review',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=v_run.id;
 return query select 'invalid_state'::text,null::jsonb; return; end if;
 update public.sync_runs set status='running',lease_owner=btrim(p_worker_id),lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
 lease_generation=lease_generation+1,started_at=coalesce(started_at,clock_timestamp()),error_code=null
 where organization_id=p_organization_id and id=v_run.id returning * into v_run;
 insert into public.sync_run_attempts(organization_id,sync_run_id,lease_generation,worker_id,phase)
 values(p_organization_id,v_run.id,v_run.lease_generation,btrim(p_worker_id),v_run.work_kind);
 select coalesce(jsonb_agg(i.source_snapshot order by i.created_at,i.id),'[]'::jsonb) into v_sources from public.sync_run_plan_items i
 where i.organization_id=p_organization_id and i.sync_run_id=v_run.replay_parent_run_id and i.source_snapshot is not null;
 return query select 'claimed'::text,public.m2_v2_sync_run_json(v_run)||jsonb_build_object('actorId',v_run.actor_user_id,'commitActorId',v_run.commit_actor_user_id,
 'connectionRevision',v_run.connection_revision,'credentialRevision',v_run.credential_revision,'permissionVersion',v_run.permission_version,
 'leaseGeneration',v_run.lease_generation,'fieldMappingSnapshot',v_run.mapping_snapshot,'fieldMappingRevision',v_run.field_mapping_revision,
 'schemaSnapshot',v_run.schema_snapshot,'authoritySnapshot',v_run.authority_snapshot,'replaySourceMode',v_run.replay_source_mode,'replaySourceRecords',v_sources);
end $$;

create function public.m1102_fail_sync_run_atomic(p_organization_id uuid,p_sync_run_id uuid,p_worker_id text,p_generation integer,p_error_code text,p_retryable boolean,p_retry_after_seconds integer)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.sync_runs%rowtype; v_delay double precision; v_retry boolean; v_category text; v_code text;
begin
 select * into v_run from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id and status='running'
 and lease_owner=btrim(p_worker_id) and lease_generation=p_generation and lease_expires_at>clock_timestamp() for update;
 if not found then return query select 'lease_lost'::text,null::jsonb; return; end if;
 v_code:=case when p_error_code in ('auth_failed','missing_scope','unreachable','rate_limited','timeout','provider_unavailable','malformed_response','unsupported_capability',
 'transient_database','stale_preview','configuration_changed','unsupported_connector_type','vault_unavailable','worker_exception','cursor_drifted','blocked_by_records','payload_too_large','cursor_expired','cursor_invalid','authorization_changed','plan_basis_changed','schema_changed','invalid_record','commit_apply_failed','database_unavailable','unknown') then p_error_code else 'unknown' end;
 v_category:=case when v_code='timeout' then 'timeout' when v_code in ('unreachable','provider_unavailable') then 'provider_unavailable' when v_code in ('database_unavailable','transient_database') then 'transient_database' when v_code='rate_limited' then 'rate_limit' when v_code in ('auth_failed','missing_scope') then 'authentication' when v_code='authorization_changed' then 'authorization' when v_code in ('unsupported_capability','unsupported_connector_type') then 'unsupported' when v_code in ('stale_preview','configuration_changed','plan_basis_changed','cursor_drifted','cursor_expired','cursor_invalid') then 'stale_preview' when v_code in ('vault_unavailable','worker_exception','unknown') then 'unknown' else 'invalid_data' end;
 v_delay:=least(300,5*power(2,v_run.retry_count));
 v_delay:=v_delay/2+random()*v_delay/2;
 v_delay:=greatest(v_delay,coalesce(greatest(0,p_retry_after_seconds),0));
 v_retry:=coalesce(p_retryable,false) and v_category in ('timeout','provider_unavailable','transient_database','rate_limit') and v_run.retry_count<5
 and clock_timestamp()+make_interval(secs=>v_delay)<v_run.expires_at;
 update public.sync_runs set status=case when v_retry then 'retrying' else 'failed' end,
 retry_count=retry_count+case when v_retry then 1 else 0 end,next_attempt_at=clock_timestamp()+make_interval(secs=>v_delay),
 error_code=v_code,lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_sync_run_id returning * into v_run;
 update public.sync_run_attempts set finished_at=clock_timestamp(),outcome=case when v_retry then 'retrying' else 'failed' end,
 error_category=v_category,error_code=v_code,next_attempt_at=case when v_retry then v_run.next_attempt_at else null end,
 affected_record_ids=coalesce((select array_agg(id) from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id and record_outcome='failed'),'{}'::uuid[])
 where organization_id=p_organization_id and sync_run_id=p_sync_run_id and lease_generation=p_generation and finished_at is null;
 if not v_retry then
 update public.sync_run_plan_items set record_outcome=case when record_outcome='failed' then 'failed' else 'withheld' end,
 dead_lettered_at=coalesce(dead_lettered_at,clock_timestamp()) where organization_id=p_organization_id and sync_run_id=p_sync_run_id and applied_at is null and record_outcome<>'skipped';
 update public.sync_runs set failed_count=(select count(*) from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id and record_outcome='failed'),
 pending_count=(select count(*) from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id and record_outcome in ('pending','withheld'))
 where organization_id=p_organization_id and id=p_sync_run_id returning * into v_run;
 end if;
 return query select v_run.status,public.m2_v2_sync_run_json(v_run);
end $$;

create function public.m1102_save_sync_run_plan_atomic(p_organization_id uuid,p_sync_run_id uuid,p_worker_id text,p_generation integer,
 p_cursor_to text,p_fetch_content_hash text,p_plan_items jsonb,p_conflicts jsonb,p_schema_snapshot jsonb)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.sync_runs%rowtype; v_result record; v_item jsonb; v_failed integer; v_skipped integer; v_count integer;
begin
 perform 1 from public.connectors where organization_id=p_organization_id and id=(select connector_id from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id) for share;
 select * into v_run from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id and status='running'
 and lease_owner=btrim(p_worker_id) and lease_generation=p_generation and lease_expires_at>clock_timestamp() for update;
 if not found then return query select 'lease_lost'::text,null::jsonb; return; end if;
 if not public.m11_assert_sync_run_fence(p_organization_id,p_sync_run_id,null) or v_run.authority_snapshot is distinct from public.m1102_authority_snapshot(p_organization_id,v_run.connector_id) then
 return query select 'invalid_state'::text,null::jsonb; return; end if;
 if jsonb_typeof(p_plan_items) is distinct from 'array' or jsonb_array_length(p_plan_items)>200 or jsonb_typeof(p_schema_snapshot) is distinct from 'object' or octet_length(p_schema_snapshot::text)>64000 then
 return query select 'invalid_request'::text,null::jsonb; return; end if;
 if v_run.schema_snapshot is not null and v_run.schema_snapshot<>p_schema_snapshot then return query select 'schema_changed'::text,null::jsonb; return; end if;
 -- Existing planner owns conflict insertion and dry-run transitions. Count fencing
 -- occurs after it has calculated row_count; legacy helper remains shape-compatible.
 select * into v_result from public.save_sync_run_plan_atomic(p_organization_id,p_sync_run_id,p_worker_id,p_cursor_to,p_fetch_content_hash,p_plan_items,p_conflicts);
 if v_result.outcome<>'saved' then return query select v_result.outcome,v_result.run; return; end if;
 for v_item in select value from jsonb_array_elements(p_plan_items) loop
 update public.sync_run_plan_items set source_snapshot=v_item->'sourceSnapshot',
 record_outcome=case when proposed_action in ('rejected','pending_required_fields','ambiguous_match') then 'failed'
 when proposed_action in ('unchanged','skipped_tombstone') then 'skipped' else 'pending' end,
 error_category=case when proposed_action in ('rejected','pending_required_fields','ambiguous_match') then 'invalid_data' end,
 error_code=case when proposed_action in ('rejected','pending_required_fields','ambiguous_match') then 'invalid_record' end,
 dead_lettered_at=case when proposed_action in ('rejected','pending_required_fields','ambiguous_match') then clock_timestamp() end
 where organization_id=p_organization_id and sync_run_id=p_sync_run_id and entity_type=v_item->>'entityType' and external_id=v_item->>'externalId';
 end loop;
 if exists(select 1 from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id and record_outcome='failed') then
 update public.sync_run_plan_items set record_outcome='withheld' where organization_id=p_organization_id and sync_run_id=p_sync_run_id and record_outcome='pending';
 end if;
 select count(*),count(*) filter(where record_outcome='failed'),count(*) filter(where record_outcome='skipped') into v_count,v_failed,v_skipped
 from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id;
 update public.sync_runs set schema_snapshot=p_schema_snapshot,row_count=v_count,processed_count=v_count,failed_count=v_failed,skipped_count=v_skipped,
 pending_count=v_count-v_failed-v_skipped,succeeded_count=0,skip_count=(select count(*) from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id and proposed_action='skipped_tombstone'),
 -- Replays always receive explicit review, even with an automatic connector.
 status=case when v_failed>0 then 'failed' when replay_parent_run_id is not null then 'waiting_for_review' else status end,
 work_kind=case when replay_parent_run_id is not null then 'dry_run' else work_kind end
 where organization_id=p_organization_id and id=p_sync_run_id returning * into v_run;
 update public.sync_run_attempts set finished_at=clock_timestamp(),outcome=case when v_failed>0 then 'failed' else 'succeeded' end,
 error_category=case when v_failed>0 then 'invalid_data' end,error_code=case when v_failed>0 then 'invalid_record' end,
 affected_record_ids=coalesce((select array_agg(id) from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id and record_outcome='failed'),'{}'::uuid[])
 where organization_id=p_organization_id and sync_run_id=p_sync_run_id and lease_generation=p_generation and finished_at is null;
 return query select 'saved'::text,public.m2_v2_sync_run_json(v_run);
end $$;
-- Reuse the existing, fully implemented domain commit. Clone its body privately
-- so old callers retain their projection while the new wrapper owns failure policy.
do $$
declare v_def text; v_at integer;
begin
 select pg_get_functiondef('public.commit_sync_run_atomic(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure) into v_def;
 v_def:=replace(v_def,'FUNCTION public.commit_sync_run_atomic(','FUNCTION public.m1102_commit_plan_internal(');
 v_at:=strpos(reverse(v_def),reverse('exception when others then'));
 if v_at=0 then raise exception 'M11-02 commit exception anchor missing'; end if;
 v_at:=length(v_def)-v_at-length('exception when others then')+2;
 v_def:=left(v_def,v_at-1)||E'exception when others then\n raise exception using errcode=SQLSTATE,message=''sync_commit_failed'',detail=coalesce(v_item.id::text,'''');\nend;\n$function$;';
 execute v_def;
 select pg_get_functiondef('public.save_sync_run_plan_atomic(uuid,uuid,text,text,text,jsonb,jsonb)'::regprocedure) into v_def;
 if strpos(v_def,'v_connector.commit_policy = ''manual''')=0 then raise exception 'M11-02 replay review anchor missing'; end if;
 execute replace(v_def,'v_connector.commit_policy = ''manual''','(v_connector.commit_policy = ''manual'' or v_run.replay_parent_run_id is not null)');
end $$;
revoke all on function public.m1102_commit_plan_internal(uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.m1102_commit_sync_run_atomic(p_organization_id uuid,p_sync_run_id uuid,p_actor_user_id uuid,p_worker_id text,p_generation integer,
 p_fetch_content_hash text,p_idempotency_key uuid,p_correlation_id uuid)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.sync_runs%rowtype; v_result record; v_cursor text; v_detail text; v_record uuid; v_retryable boolean;
begin
 perform 1 from public.connectors where organization_id=p_organization_id and id=(select connector_id from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id) for share;
 select * into v_run from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id for update;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if not public.m11_assert_sync_run_fence(p_organization_id,p_sync_run_id,p_actor_user_id) then return query select 'invalid_state'::text,null::jsonb; return; end if;
 if v_run.status='completed' and v_run.commit_idempotency_key=p_idempotency_key then return query select 'completed'::text,public.m2_v2_sync_run_json(v_run); return; end if;
 if v_run.status<>'running' or v_run.work_kind<>'commit' or v_run.lease_owner is distinct from btrim(p_worker_id)
 or v_run.lease_generation<>p_generation or v_run.lease_expires_at<=clock_timestamp() then return query select 'lease_lost'::text,null::jsonb; return; end if;
 if v_run.mapping_snapshot is null or v_run.schema_snapshot is null or v_run.authority_snapshot is distinct from public.m1102_authority_snapshot(p_organization_id,v_run.connector_id) then
 return query select 'plan_basis_changed'::text,null::jsonb; return; end if;
 select cursor into v_cursor from public.sync_connector_cursors where organization_id=p_organization_id and connector_id=v_run.connector_id for update;
 if v_cursor is distinct from v_run.cursor_baseline then return query select 'cursor_drifted'::text,null::jsonb; return; end if;
 if exists(select 1 from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id
 and proposed_action in ('rejected','pending_required_fields','ambiguous_match')) then return query select 'blocked_by_records'::text,null::jsonb; return; end if;
 begin
 select * into v_result from public.m1102_commit_plan_internal(p_organization_id,p_sync_run_id,p_actor_user_id,p_fetch_content_hash,p_idempotency_key,p_correlation_id);
 exception when others then
 get stacked diagnostics v_detail=PG_EXCEPTION_DETAIL;
 v_retryable:=SQLSTATE in ('40001','40P01','55P03','57014','08000','08003','08006','53300','57P01');
 if not v_retryable and v_detail ~ '^[0-9a-fA-F-]{36}$' then
 v_record:=v_detail::uuid;
 update public.sync_run_plan_items set record_outcome='failed',error_category='invalid_data',error_code='commit_apply_failed',dead_lettered_at=clock_timestamp()
 where organization_id=p_organization_id and sync_run_id=p_sync_run_id and id=v_record;
 end if;
 return query select * from public.m1102_fail_sync_run_atomic(p_organization_id,p_sync_run_id,p_worker_id,p_generation,
 case when v_retryable then 'database_unavailable' else 'commit_apply_failed' end,v_retryable,null);
 return;
 end;
 if v_result.outcome='completed' then
 update public.sync_run_plan_items i set dead_letter_resolved_at=clock_timestamp() from public.sync_runs r where i.organization_id=p_organization_id
 and i.sync_run_id=r.id and r.organization_id=p_organization_id and coalesce(r.replay_root_run_id,r.id)=coalesce(v_run.replay_root_run_id,v_run.id) and i.dead_lettered_at is not null and i.dead_letter_resolved_at is null;
 update public.sync_run_plan_items set record_outcome=case when proposed_action in ('unchanged','skipped_tombstone') then 'skipped' else 'succeeded' end,
 dead_lettered_at=null,error_category=null,error_code=null where organization_id=p_organization_id and sync_run_id=p_sync_run_id;
 update public.sync_runs set succeeded_count=(select count(*) from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id and record_outcome='succeeded'),
 skipped_count=(select count(*) from public.sync_run_plan_items where organization_id=p_organization_id and sync_run_id=p_sync_run_id and record_outcome='skipped'),failed_count=0,pending_count=0
 where organization_id=p_organization_id and id=p_sync_run_id returning * into v_run;
 update public.sync_run_attempts set finished_at=clock_timestamp(),outcome='succeeded' where organization_id=p_organization_id and sync_run_id=p_sync_run_id and lease_generation=p_generation and finished_at is null;
 return query select 'completed'::text,public.m2_v2_sync_run_json(v_run); return;
 end if;
 update public.sync_run_attempts set finished_at=clock_timestamp(),outcome='review_required',error_category='stale_preview',error_code='plan_basis_changed'
 where organization_id=p_organization_id and sync_run_id=p_sync_run_id and lease_generation=p_generation and finished_at is null;
 return query select v_result.outcome,v_result.run;
end $$;
-- The existing command ledger provides command durability; no second ledger.
alter table public.connector_commands drop constraint connector_commands_operation_check;
alter table public.connector_commands add constraint connector_commands_operation_check
 check(operation in ('configure','replace_secret','revoke_secret','disconnect','reconnect','test_connection','save_field_mapping','replay_sync'));

create function public.m1102_save_field_mapping(p_org_id uuid,p_actor_id uuid,p_connector_id uuid,p_permission_version bigint,
 p_expected_version integer,p_expected_mapping_revision integer,p_idempotency_key uuid,p_request_digest text,p_request_digest_key_id text,p_schema_digest text,p_fields jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_command public.connector_commands%rowtype; v_field jsonb; v_result jsonb;
begin
 if not public.m11_lock_connector_authorization(p_org_id,p_actor_id,p_permission_version) then raise exception 'forbidden'; end if;
 select * into v_connector from public.connectors where organization_id=p_org_id and id=p_connector_id and archived_at is null for update;
 if not found then raise exception 'not_found'; end if;
 select * into v_command from public.connector_commands where organization_id=p_org_id and actor_user_id=p_actor_id and idempotency_key=p_idempotency_key for update;
 if found then
 if v_command.connector_id<>p_connector_id or v_command.operation<>'save_field_mapping' or v_command.request_digest<>p_request_digest or v_command.request_digest_key_id<>p_request_digest_key_id then raise exception 'idempotency_conflict'; end if;
 return v_command.result;
 end if;
 if v_connector.version<>p_expected_version or v_connector.field_mapping_revision<>p_expected_mapping_revision then raise exception 'conflict'; end if;
 if p_idempotency_key is null or p_request_digest is null or p_request_digest_key_id is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_schema_digest is null or p_schema_digest !~ '^[a-f0-9]{64}$' or p_request_digest_key_id !~ '^[A-Za-z0-9_.-]{1,80}$'
 or jsonb_typeof(p_fields) is distinct from 'array' or jsonb_array_length(p_fields)>32 or octet_length(p_fields::text)>20000 then raise exception 'invalid_request'; end if;
 for v_field in select value from jsonb_array_elements(p_fields) loop
 if jsonb_typeof(v_field)<>'object' or v_field->>'transform' is distinct from 'identity'
 or v_field-array['entityType','sourceField','targetField','transform']<>'{}'::jsonb
 or coalesce(v_field->>'sourceField','') !~ '^[A-Za-z][A-Za-z0-9_.-]{0,127}$'
 or exists(select 1 from unnest(string_to_array(v_field->>'sourceField','.')) part where part in ('__proto__','prototype','constructor'))
 or not coalesce((v_field->>'entityType'='product' and v_field->>'targetField' in ('name','internalCode','productType','description'))
 or(v_field->>'entityType'='release' and v_field->>'targetField' in ('label','releaseVersion','description')),false) then raise exception 'invalid_request'; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_fields) f group by f->>'entityType',f->>'targetField' having count(*)>1) then raise exception 'invalid_request'; end if;
 update public.connectors set field_map=p_fields,field_mapping_revision=field_mapping_revision+1,mapping_schema_digest=p_schema_digest,
 version=version+1,updated_by=p_actor_id where organization_id=p_org_id and id=p_connector_id returning * into v_connector;
 v_result:=jsonb_build_object('revision',v_connector.field_mapping_revision,'fields',v_connector.field_map);
 insert into public.connector_commands(organization_id,connector_id,actor_user_id,operation,idempotency_key,request_digest,request_digest_key_id,state,
 expected_version,connection_revision,credential_revision,permission_version,deadline_at,result,completed_at)
 values(p_org_id,p_connector_id,p_actor_id,'save_field_mapping',p_idempotency_key,p_request_digest,p_request_digest_key_id,'completed',p_expected_version,
 v_connector.connection_revision,v_connector.credential_revision,p_permission_version,clock_timestamp(),v_result,clock_timestamp());
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_org_id,p_actor_id,'connector.field_mapping_saved','connector',p_connector_id::text,jsonb_build_object('revision',v_connector.field_mapping_revision,'fields',p_fields,'schemaDigest',p_schema_digest));
 return v_result;
end $$;

create function public.m1102_replay_preview(p_org_id uuid,p_actor_id uuid,p_connector_id uuid,p_run_id uuid,p_permission_version bigint,
 p_expected_version integer,p_mapping_mode text,p_source_mode text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_run public.sync_runs%rowtype; v_connector public.connectors%rowtype; v_cursor text; v_map jsonb; v_rev integer;
 v_records integer; v_can boolean; v_digest text; v_samples jsonb; v_issues jsonb:='[]'; v_counts jsonb;
begin
 if not public.m11_lock_connector_authorization(p_org_id,p_actor_id,p_permission_version) then raise exception 'forbidden'; end if;
 select * into v_connector from public.connectors where organization_id=p_org_id and id=p_connector_id and archived_at is null for share;
 if not found then raise exception 'not_found'; end if;
 select * into v_run from public.sync_runs where organization_id=p_org_id and connector_id=p_connector_id and id=p_run_id for share;
 if not found then raise exception 'not_found'; end if;
 if v_run.version<>p_expected_version then raise exception 'conflict'; end if;
 if p_mapping_mode is null or p_source_mode is null or p_mapping_mode not in ('preserve','rebase') or p_source_mode not in ('retained','refetch') then raise exception 'invalid_request'; end if;
 select cursor into v_cursor from public.sync_connector_cursors where organization_id=p_org_id and connector_id=p_connector_id for share;
 v_map:=case when p_mapping_mode='preserve' and v_run.mapping_snapshot is not null then v_run.mapping_snapshot else v_connector.field_map end;
 v_rev:=case when p_mapping_mode='preserve' and v_run.field_mapping_revision is not null then v_run.field_mapping_revision else v_connector.field_mapping_revision end;
 select count(*) into v_records from public.sync_run_plan_items where organization_id=p_org_id and sync_run_id=p_run_id and source_snapshot is not null;
 v_can:=v_run.status in ('failed','canceled') and v_connector.enabled and public.m11_valid_connector_config(p_org_id,v_connector.connection_config)
 and coalesce(v_connector.scope_assessment->>'status','unknown')<>'missing'
 and not exists(select 1 from public.connector_secrets s where s.organization_id=p_org_id and s.connector_id=p_connector_id and s.id=v_connector.secret_ref
 and (s.revoked_at is not null or (s.encryption_scheme='aes_256_gcm_v1' and (v_connector.last_test_outcome is distinct from 'success' or v_connector.last_test_connection_revision is distinct from v_connector.connection_revision)))) and (p_source_mode='refetch' or (v_connector.connection_revision=v_run.connection_revision
 and v_connector.credential_revision=v_run.credential_revision)) and (p_source_mode='refetch' or v_cursor is not distinct from v_run.cursor_baseline)
 and not exists(select 1 from public.sync_runs where organization_id=p_org_id and connector_id=p_connector_id and status in ('queued','running','retrying','waiting_for_review'))
 and not public.m1102_run_recovered(p_org_id,p_run_id)
 and (p_source_mode='refetch' or (v_run.mapping_snapshot is not null and v_run.schema_snapshot is not null and v_records=v_run.row_count));
 if not v_can then v_issues:=jsonb_build_array(case when p_source_mode='retained' and (v_records<>v_run.row_count or v_run.mapping_snapshot is null or v_run.schema_snapshot is null) then jsonb_build_object('code','snapshot_unavailable','message','Retained source data is unavailable. Select explicit refetch.') when v_cursor is distinct from v_run.cursor_baseline then jsonb_build_object('code','cursor_changed','message','The connector cursor changed. Review a fresh reconciliation.') else jsonb_build_object('code','authorization_changed','message','Current access no longer permits this operation.') end); end if;
 select coalesce(jsonb_agg(jsonb_build_object('entityType',entity_type,'externalId',external_id,'proposedAction',proposed_action)),'[]'::jsonb) into v_samples
 from (select entity_type,external_id,proposed_action from public.sync_run_plan_items where organization_id=p_org_id and sync_run_id=p_run_id order by created_at,id limit 10) s;
 v_counts:=jsonb_build_object('create',v_run.create_count,'update',v_run.update_count,'unchanged',v_run.unchanged_count,'skip',v_run.skipped_count,'conflict',v_run.conflict_count,'failed',v_run.failed_count);
 -- Digest binds preview to current authorization/configuration/cursor and every
 -- retained source record. Provider values are never returned in this response.
 v_digest:=encode(extensions.digest(jsonb_build_object('run',v_run.id,'version',v_run.version,'actor',p_actor_id,'permission',p_permission_version,
 'connectorVersion',v_connector.version,'connection',v_connector.connection_revision,'credential',v_connector.credential_revision,
 'mappingMode',p_mapping_mode,'sourceMode',p_source_mode,'mapping',v_map,'mappingRevision',v_rev,'cursor',v_cursor,
 'authority',public.m1102_authority_snapshot(p_org_id,p_connector_id),'source',(select coalesce(jsonb_agg(source_snapshot order by created_at,id),'[]'::jsonb)
 from public.sync_run_plan_items where organization_id=p_org_id and sync_run_id=p_run_id))::text,'sha256'),'hex');
 return jsonb_build_object('previewDigest',v_digest,'runId',p_run_id,'runVersion',v_run.version,'mappingRevision',v_rev,'mappingMode',p_mapping_mode,
 'sourceMode',p_source_mode,'recordCount',v_run.row_count,'issues',v_issues,'canReplay',v_can,'proposedCounts',v_counts,'samples',v_samples);
end $$;

create function public.m1102_replay_sync_run(p_org_id uuid,p_actor_id uuid,p_connector_id uuid,p_run_id uuid,p_permission_version bigint,
 p_expected_version integer,p_mapping_mode text,p_source_mode text,p_idempotency_key uuid,p_request_digest text,p_request_digest_key_id text,p_preview_digest text,p_reason text)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connector public.connectors%rowtype; v_parent public.sync_runs%rowtype; v_child public.sync_runs%rowtype; v_cmd public.connector_commands%rowtype; v_preview jsonb;
begin
 if not public.m11_lock_connector_authorization(p_org_id,p_actor_id,p_permission_version) then return query select 'forbidden'::text,null::jsonb; return; end if;
 select * into v_connector from public.connectors where organization_id=p_org_id and id=p_connector_id and archived_at is null for update;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_cmd from public.connector_commands where organization_id=p_org_id and actor_user_id=p_actor_id and idempotency_key=p_idempotency_key for update;
 if found then
 if v_cmd.connector_id<>p_connector_id or v_cmd.operation<>'replay_sync' or v_cmd.request_digest<>p_request_digest or v_cmd.request_digest_key_id<>p_request_digest_key_id then
 return query select 'idempotency_conflict'::text,null::jsonb; return; end if;
 return query select 'replayed'::text,v_cmd.result->'run'; return;
 end if;
 select * into v_parent from public.sync_runs where organization_id=p_org_id and connector_id=p_connector_id and id=p_run_id for update;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_parent.version<>p_expected_version then return query select 'conflict'::text,null::jsonb; return; end if;
 if p_idempotency_key is null or p_request_digest is null or p_request_digest_key_id is null or p_request_digest !~ '^[a-f0-9]{64}$' or p_request_digest_key_id !~ '^[A-Za-z0-9_.-]{1,80}$'
 or char_length(btrim(coalesce(p_reason,''))) not between 1 and 500 then return query select 'invalid_request'::text,null::jsonb; return; end if;
 v_preview:=public.m1102_replay_preview(p_org_id,p_actor_id,p_connector_id,p_run_id,p_permission_version,p_expected_version,p_mapping_mode,p_source_mode);
 if v_preview->>'previewDigest' is distinct from p_preview_digest then return query select 'conflict'::text,null::jsonb; return; end if;
 if not(v_preview->>'canReplay')::boolean then return query select 'invalid_state'::text,null::jsonb; return; end if;
 insert into public.sync_runs(organization_id,connector_id,reconciliation_kind,work_kind,status,actor_kind,actor_user_id,trigger_idempotency_key,trigger_request_digest,
 adapter_version,mapping_version,cursor_from,cursor_to,correlation_id,expires_at,next_attempt_at,replay_parent_run_id,replay_source_mode)
 values(p_org_id,p_connector_id,case when p_source_mode='refetch' and v_parent.cursor_baseline is distinct from (select cursor from public.sync_connector_cursors where organization_id=p_org_id and connector_id=p_connector_id) then 'full' else v_parent.reconciliation_kind end,'dry_run','queued','user',p_actor_id,p_idempotency_key,p_request_digest,
 v_connector.adapter_version,v_connector.mapping_version,case when p_source_mode='refetch' and v_parent.cursor_baseline is distinct from (select cursor from public.sync_connector_cursors where organization_id=p_org_id and connector_id=p_connector_id) then null else v_parent.cursor_from end,v_parent.cursor_to,gen_random_uuid(),clock_timestamp()+interval '24 hours',case when v_parent.error_code='rate_limited' then greatest(clock_timestamp(),v_parent.next_attempt_at) else clock_timestamp() end,p_run_id,p_source_mode)
 returning * into v_child;
 -- Insert trigger captured current authority/access. Only mapping interpretation
 -- is optionally inherited, never old permissions or protected-field authority.
 if p_mapping_mode='preserve' and v_parent.mapping_snapshot is not null then
 update public.sync_runs set mapping_snapshot=v_parent.mapping_snapshot,field_mapping_revision=v_parent.field_mapping_revision,
 schema_snapshot=case when p_source_mode='retained' then v_parent.schema_snapshot else null end
 where organization_id=p_org_id and id=v_child.id returning * into v_child;
 end if;
 insert into public.connector_commands(organization_id,connector_id,actor_user_id,operation,idempotency_key,request_digest,request_digest_key_id,state,
 expected_version,connection_revision,credential_revision,permission_version,deadline_at,result,completed_at)
 values(p_org_id,p_connector_id,p_actor_id,'replay_sync',p_idempotency_key,p_request_digest,p_request_digest_key_id,'completed',v_connector.version,
 v_connector.connection_revision,v_connector.credential_revision,p_permission_version,clock_timestamp(),jsonb_build_object('run',public.m2_v2_sync_run_json(v_child)),clock_timestamp());
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_org_id,p_actor_id,'sync_run.replay_requested','sync_run',v_child.id::text,jsonb_build_object('parentRunId',p_run_id,'mappingMode',p_mapping_mode,'sourceMode',p_source_mode,
 'mappingRevision',v_child.field_mapping_revision,'reasonProvided',true,'previewDigest',p_preview_digest));
 return query select 'queued'::text,public.m2_v2_sync_run_json(v_child);
end $$;
-- Flat batch identity resolves failed replay siblings without recursive depth limits.
create function public.m1102_run_recovered(p_org uuid,p_run uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.sync_runs r where r.organization_id=p_org and r.status='completed'
 and coalesce(r.replay_root_run_id,r.id)=(select coalesce(replay_root_run_id,id) from public.sync_runs where organization_id=p_org and id=p_run))
$$;
create or replace function public.m11_begin_sync_run_atomic(p_organization_id uuid,p_connector_id uuid,p_actor_user_id uuid,p_permission_version bigint,
 p_reconciliation_kind text,p_idempotency_key uuid,p_correlation_id uuid)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m11_lock_connector_authorization(p_organization_id,p_actor_user_id,p_permission_version) then return query select 'forbidden'::text,null::jsonb; return; end if;
 perform 1 from public.connectors where organization_id=p_organization_id and id=p_connector_id for update;
 if exists(select 1 from public.sync_runs r where r.organization_id=p_organization_id and r.connector_id=p_connector_id and r.status='failed'
 and not public.m1102_run_recovered(p_organization_id,r.id))
 and not exists(select 1 from public.sync_runs where organization_id=p_organization_id and actor_user_id=p_actor_user_id and trigger_idempotency_key=p_idempotency_key) then
 return query select 'blocked_by_dead_letter'::text,null::jsonb; return; end if;
 return query select * from public.begin_sync_run_atomic(p_organization_id,p_connector_id,p_actor_user_id,p_reconciliation_kind,p_idempotency_key,p_correlation_id);
end $$;
create or replace function public.retry_sync_run_atomic(p_organization_id uuid,p_sync_run_id uuid,p_actor_user_id uuid)
returns table(outcome text,run jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 if not exists(select 1 from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 return query select 'preview_required'::text,null::jsonb;
end $$;

-- Export metadata and source payload exclusion. Existing tenant purge cascades
-- through organization/run FKs; replay parents are scoped and cannot escape it.
insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort)
values('connector_sync','sync_run_attempts','organization_id','id',8)
on conflict(source_id,table_name) do nothing;
do $$
declare v_def text; v_anchor text;
begin
 select pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure) into v_def;
 v_anchor:='public.sync_connector_cursors';
 if position(v_anchor in v_def)=0 then raise exception 'M11-02 export lock anchor missing'; end if;
 execute replace(v_def,v_anchor,'public.sync_connector_cursors, public.sync_run_attempts');
 select pg_get_functiondef('public.m1_export_business_record_jsonb(text,jsonb)'::regprocedure) into v_def;
 v_anchor:='  case p_table_name';
 if position(v_anchor in v_def)=0 then raise exception 'M11-02 export projection anchor missing'; end if;
 execute replace(v_def,v_anchor,E'  if p_table_name=''sync_run_plan_items'' then return v_record-array[''source_snapshot'']; end if;\n  if p_table_name=''sync_runs'' then return v_record-array[''schema_snapshot'',''authority_snapshot'']; end if;\n'||v_anchor);
end $$;

create function public.m1102_renew_sync_run_lease(p_organization_id uuid,p_sync_run_id uuid,p_worker_id text,p_generation integer,p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_lease_seconds is null or p_lease_seconds not between 10 and 300 then return false; end if;
 perform 1 from public.connectors where organization_id=p_organization_id and id=(select connector_id from public.sync_runs where organization_id=p_organization_id and id=p_sync_run_id) for share;
 if not public.m11_assert_sync_run_fence(p_organization_id,p_sync_run_id,null) then return false; end if;
 update public.sync_runs set lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
 where organization_id=p_organization_id and id=p_sync_run_id and status='running' and lease_owner=btrim(p_worker_id)
 and lease_generation=p_generation and lease_expires_at>clock_timestamp();
 return found;
end $$;

-- Only inward infrastructure calls these RPCs. Private commit clone deliberately
-- remains ungranted; wrappers execute it as the definer within the same transaction.
do $$
declare v_proc record;
begin
 for v_proc in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'm1102_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',v_proc.signature);
 if v_proc.proname in ('m1102_list_due_sync_run_organizations','m1102_claim_sync_run','m1102_renew_sync_run_lease','m1102_fail_sync_run_atomic','m1102_save_sync_run_plan_atomic','m1102_commit_sync_run_atomic','m1102_save_field_mapping','m1102_replay_preview','m1102_replay_sync_run') then execute format('grant execute on function %s to service_role',v_proc.signature); end if;
 end loop;
end $$;
